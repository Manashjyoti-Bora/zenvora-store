import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * kickJobRunner reliability contract (serverless lifecycle fix):
 *  - inside a Next request scope it registers the STABLE run promise with
 *    `after()` so serverless platforms (Vercel waitUntil) keep the function
 *    alive until queued work — e.g. password-reset notification jobs —
 *    actually runs after the HTTP response;
 *  - the registered callback must reference the captured `run` promise, not
 *    the mutable `runnerInFlight` slot (which is nulled in `finally` and may
 *    already be null — or point at a different run — by callback time);
 *  - outside a request scope (scripts, tests, direct service calls) after()
 *    throws and the kick degrades to the historical fire-and-forget behavior;
 *  - the in-flight guard prevents parallel duplicate runs from bursts.
 */

const afterMock = vi.fn();
vi.mock('next/server', () => ({
  after: (cb: () => Promise<unknown>) => afterMock(cb),
}));

const processDueJobs = vi.fn(async () => ({ claimed: 0, succeeded: 0, failed: 0, retried: 0, rescheduled: 0 }));
vi.mock('../../src/lib/jobs/runner', () => ({
  processDueJobs: () => processDueJobs(),
}));

import { kickJobRunner } from '@/lib/jobs/queue';

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

describe('kickJobRunner (serverless after() reliability + fallback)', () => {
  beforeEach(() => {
    afterMock.mockReset();
    processDueJobs.mockClear();
  });

  it('registers the run via after() when inside a request scope', async () => {
    kickJobRunner();
    expect(afterMock).toHaveBeenCalledTimes(1);
    // The kick itself runs the queue…
    await settle();
    expect(processDueJobs).toHaveBeenCalledTimes(1);
    // …and the after() callback resolves the SAME captured run (idempotent —
    // safe even though runnerInFlight was already nulled by `finally`).
    const callback = afterMock.mock.calls[0][0] as () => Promise<unknown>;
    await callback();
    expect(processDueJobs).toHaveBeenCalledTimes(1);
  });

  it('bursts inside one run are guarded (single execution, single registration)', async () => {
    kickJobRunner();
    kickJobRunner();
    kickJobRunner();
    await settle();
    expect(processDueJobs).toHaveBeenCalledTimes(1);
    expect(afterMock).toHaveBeenCalledTimes(1);
  });

  it('outside a request scope: after() throws → fire-and-forget preserved, no crash', async () => {
    afterMock.mockImplementation(() => {
      throw new Error('after() called outside a request scope');
    });
    expect(() => kickJobRunner()).not.toThrow();
    await settle();
    expect(processDueJobs).toHaveBeenCalledTimes(1);
  });
});
