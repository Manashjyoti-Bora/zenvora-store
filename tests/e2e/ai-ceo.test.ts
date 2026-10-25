import './env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';

import { e2eAdmin } from './env';
import { HttpAgent, errCode, okData, waitForServer } from './http';
import { createFixtureUser, createSessionAgent, sessionAgentForEmail } from './fixtures';

/**
 * E2E — AI CEO surface over real HTTP.
 *
 * Proves the security boundary, not just the UI: anonymous → 401, customer →
 * 403, staff cannot reach the ADMIN-only action route, the default posture
 * refuses execution, consequential actions are refused even for an owner, a
 * replayed idempotency key is rejected and every executed action is audited.
 */

const DEFAULT_CONFIG = {
  enabled: true,
  actionsEnabled: false,
  dailyActionLimit: 20,
  providerNarrativeEnabled: false,
  monthlyTokenBudget: 25_000,
};

let adminAgent: HttpAgent;
let customerAgent: HttpAgent;
let staffAgent: HttpAgent;
let executedKey = '';

beforeAll(async () => {
  await waitForServer();
  if (!e2eAdmin.email || !e2eAdmin.password) throw new Error('ADMIN_EMAIL/ADMIN_PASSWORD missing from .env');

  // Sessions are minted straight into the database (only sha256(token) stored,
  // as the app does). This spec verifies AUTHORIZATION; auth-flow owns login,
  // and the login endpoint is deliberately rate-limited to 20 / 15 min / IP.
  adminAgent = await sessionAgentForEmail(e2eAdmin.email);

  // Deterministic starting posture, whatever a previous run left behind.
  const reset = await adminAgent.patch('/api/admin/ai-ceo/config', DEFAULT_CONFIG);
  expect(reset.status).toBe(200);

  customerAgent = await createSessionAgent(await createFixtureUser('ai-ceo-customer', 'CUSTOMER'));

  // STAFF exists in the role model but the admin area (and therefore the action
  // route) is ADMIN-only; this proves the API agrees.
  staffAgent = await createSessionAgent(await createFixtureUser('ai-ceo-staff', 'STAFF'));

  executedKey = `e2e-ai-ceo-${Date.now()}`;
}, 180_000);

afterAll(async () => {
  // Leave the shared E2E database exactly as the defaults expect.
  if (adminAgent) await adminAgent.patch('/api/admin/ai-ceo/config', DEFAULT_CONFIG);
  await prisma.$disconnect();
});

describe('AI CEO — report endpoint', () => {
  it('rejects anonymous callers', async () => {
    const anon = new HttpAgent();
    await anon.get('/api/health');
    expect((await anon.get('/api/admin/ai-ceo/report')).status).toBe(401);
  });

  it('rejects a signed-in customer', async () => {
    expect((await customerAgent.get('/api/admin/ai-ceo/report')).status).toBe(403);
  });

  it('returns a deterministic, evidence-labelled report to an admin', async () => {
    const res = await adminAgent.get('/api/admin/ai-ceo/report');
    expect(res.status).toBe(200);
    const report = okData<{
      generatedAt: string;
      headline: string;
      dataGaps: string[];
      overallLevel: string;
      sales: { metrics: Array<{ key: string; basis: string }>; caveats: string[] };
      recommendations: Array<{ id: string; evidence: unknown[]; proposedAction: { executable: boolean } }>;
      readiness: Array<{ blocks: string[]; status: string }>;
      modes: { authorisedBusinessOperations: boolean };
      provider: { status: string; narrativeAvailable: boolean };
    }>(res);

    expect(report).toBeDefined();
    expect(report?.headline.length).toBeGreaterThan(0);
    expect(Array.isArray(report?.dataGaps)).toBe(true);
    expect(report?.modes.authorisedBusinessOperations).toBe(false);
    expect(['VERIFIED', 'DERIVED', 'ESTIMATE', 'UNKNOWN']).toContain(report?.sales.metrics[0]?.basis);
    for (const rec of report?.recommendations ?? []) {
      expect(rec.evidence.length).toBeGreaterThan(0);
    }
    // No provider is configured in CI: narrative must be unavailable, not faked.
    expect(report?.provider.status).toBe('DISABLED');
    expect(report?.provider.narrativeAvailable).toBe(false);
  });

  it('rejects an out-of-range window instead of guessing', async () => {
    expect((await adminAgent.get('/api/admin/ai-ceo/report?windowDays=9999')).status).toBe(400);
  });
});

describe('AI CEO — tools endpoint', () => {
  it('rejects a customer and accepts an admin for a level-2 tool', async () => {
    expect((await customerAgent.post('/api/admin/ai-ceo/tool', { tool: 'getStoreHealth' })).status).toBe(403);

    const res = await adminAgent.post('/api/admin/ai-ceo/tool', { tool: 'getStoreHealth' });
    expect(res.status).toBe(200);
    const data = okData<{ tool: string; sideEffects: string; data: unknown }>(res);
    expect(data?.tool).toBe('getStoreHealth');
    expect(data?.sideEffects).toBe('NONE');
  });

  it('rejects unknown tools and unknown input keys', async () => {
    const unknownTool = await adminAgent.post('/api/admin/ai-ceo/tool', { tool: 'runArbitrarySql' });
    expect(unknownTool.status).toBe(400);
    expect(errCode(unknownTool)).toBe('UNKNOWN_TOOL');

    const extraKey = await adminAgent.post('/api/admin/ai-ceo/tool', {
      tool: 'getStoreHealth',
      input: { verbose: true },
    });
    expect(extraKey.status).toBe(400);
  });
});

describe('AI CEO — action endpoint', () => {
  it('is closed by the kill switch posture by default', async () => {
    const res = await adminAgent.post('/api/admin/ai-ceo/action', {
      actionKey: 'RUN_JOB_QUEUE',
      idempotencyKey: `e2e-off-${Date.now()}`,
    });
    expect(res.status).toBe(409);
    expect(errCode(res)).toBe('ACTIONS_DISABLED');
  });

  it('refuses staff and customers outright', async () => {
    for (const agent of [staffAgent, customerAgent]) {
      const res = await agent.post('/api/admin/ai-ceo/action', {
        actionKey: 'REFRESH_DERIVED_CACHE',
        idempotencyKey: `e2e-forbidden-${Math.random().toString(16).slice(2)}`,
      });
      expect(res.status).toBe(403);
    }
  });

  it('never executes a consequential action, even for an owner', async () => {
    const enable = await adminAgent.patch('/api/admin/ai-ceo/config', { actionsEnabled: true });
    expect(enable.status).toBe(200);

    const publish = await adminAgent.post('/api/admin/ai-ceo/action', {
      actionKey: 'PUBLISH_PRODUCT',
      idempotencyKey: `e2e-publish-${Date.now()}`,
    });
    expect(publish.status).toBe(403);
    expect(errCode(publish)).toBe('APPROVAL_REQUIRED');

    const refund = await adminAgent.post('/api/admin/ai-ceo/action', {
      actionKey: 'ISSUE_REFUND',
      idempotencyKey: `e2e-refund-${Date.now()}`,
    });
    expect(refund.status).toBe(403);
    expect(errCode(refund)).toBe('APPROVAL_REQUIRED');
  });

  it('executes an approved low-risk action, audits it and rejects the replay', async () => {
    const body = { actionKey: 'REFRESH_DERIVED_CACHE', idempotencyKey: executedKey };
    const first = await adminAgent.post('/api/admin/ai-ceo/action', body);
    expect(first.status).toBe(200);
    const data = okData<{ actionKey: string; audit: string; remainingToday: number }>(first);
    expect(data?.actionKey).toBe('REFRESH_DERIVED_CACHE');
    expect(data?.audit).toBe('written');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'ai_ceo.action', entityId: 'REFRESH_DERIVED_CACHE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect((audit?.data as { idempotencyKey?: string } | null)?.idempotencyKey).toBe(executedKey);

    const replay = await adminAgent.post('/api/admin/ai-ceo/action', body);
    expect(replay.status).toBe(409);
    expect(errCode(replay)).toBe('DUPLICATE');
  });

  it('requires a well-formed idempotency key', async () => {
    const res = await adminAgent.post('/api/admin/ai-ceo/action', {
      actionKey: 'REFRESH_DERIVED_CACHE',
      idempotencyKey: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('records refused attempts in the audit log', async () => {
    const denied = await prisma.auditLog.findFirst({
      where: { action: 'ai_ceo.action.denied' },
      orderBy: { createdAt: 'desc' },
    });
    expect(denied).not.toBeNull();
  });
});

describe('AI CEO — narrative endpoint', () => {
  it('is admin-only and reports the provider as unavailable without inventing text', async () => {
    expect((await customerAgent.post('/api/admin/ai-ceo/narrative', {})).status).toBe(403);

    const res = await adminAgent.post('/api/admin/ai-ceo/narrative', {});
    expect(res.status).toBe(200);
    const data = okData<{ ok: boolean; code?: string; label?: string | null }>(res);
    expect(data?.ok).toBe(false);
    expect(data?.code).toBe('DISABLED');
    expect(data?.label).toBeNull();
  });
});
