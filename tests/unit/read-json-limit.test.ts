import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_JSON_BYTES, readJson } from '@/lib/http';
import { ApiError } from '@/lib/errors';

/**
 * Request bodies are capped BEFORE schema validation. zod (3.x) accumulates
 * one issue per failing array element even when the array has `.max()`
 * (GHSA-mrhx-c7xc-m3w5), so bounding the body size is what bounds memory.
 */
function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://test.local/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

describe('readJson body cap', () => {
  it('parses ordinary bodies and returns null for invalid JSON', async () => {
    expect(await readJson(jsonRequest('{"a":1}'))).toEqual({ a: 1 });
    expect(await readJson(jsonRequest('{not json'))).toBeNull();
    expect(DEFAULT_MAX_JSON_BYTES).toBeGreaterThanOrEqual(512 * 1024);
  });

  it('rejects an oversized body with a 413 ApiError (never truncates)', async () => {
    const huge = '[' + '1,'.repeat(600) + '1]'; // ~1.2 KB
    await expect(readJson(jsonRequest(huge), { maxBytes: 1024 })).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.statusCode === 413
    );
    // Same body under a higher cap parses fine.
    const parsed = (await readJson(jsonRequest(huge), { maxBytes: 4096 })) as unknown[];
    expect(parsed).toHaveLength(601);
  });

  it('short-circuits on a declared content-length above the cap', async () => {
    await expect(
      readJson(jsonRequest('{}', { 'content-length': String(DEFAULT_MAX_JSON_BYTES + 1) }))
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.statusCode === 413);
  });

  it('measures bytes, not characters (multi-byte payloads)', async () => {
    const body = JSON.stringify({ s: '₹'.repeat(400) }); // 400 chars, 1200+ bytes
    await expect(readJson(jsonRequest(body), { maxBytes: 1000 })).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.statusCode === 413
    );
  });
});
