import { describe, expect, it } from 'vitest';
import { runTool, TOOLS } from '@/lib/ai-ceo/tools';
import { makeEmptyStoreSnapshot, makeSnapshot } from './ai-ceo-fixtures';

const snapshot = makeSnapshot();

describe('AI CEO — typed business tools', () => {
  it('rejects an unknown tool without attempting any work', () => {
    const result = runTool({ name: 'runArbitrarySql', input: {}, snapshot, level: 4 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNKNOWN_TOOL');
      expect(result.message).toMatch(/Available tools/);
    }
  });

  it('enforces the tool permission level server-side', () => {
    const forbidden = runTool({ name: 'getContributionMarginReport', input: {}, snapshot, level: 2 });
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.code).toBe('FORBIDDEN');

    const allowed = runTool({ name: 'getContributionMarginReport', input: {}, snapshot, level: 3 });
    expect(allowed.ok).toBe(true);
  });

  it('checks permission before validating input (no shape probing for low levels)', () => {
    const result = runTool({
      name: 'getContributionMarginReport',
      input: { unexpected: 'x'.repeat(10) },
      snapshot,
      level: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORBIDDEN');
  });

  it('strictly validates inputs (unknown keys and oversized limits rejected)', () => {
    const extraKey = runTool({ name: 'getStoreHealth', input: { verbose: true }, snapshot, level: 4 });
    expect(extraKey.ok).toBe(false);
    if (!extraKey.ok) expect(extraKey.code).toBe('INVALID_INPUT');

    const oversized = runTool({ name: 'getRecommendations', input: { limit: 5000 }, snapshot, level: 4 });
    expect(oversized.ok).toBe(false);

    const badCategory = runTool({ name: 'getRecommendations', input: { category: 'MONEY' }, snapshot, level: 4 });
    expect(badCategory.ok).toBe(false);
  });

  it('returns aggregates only — no customer identifiers', () => {
    for (const name of Object.keys(TOOLS) as Array<keyof typeof TOOLS>) {
      const result = runTool({ name, input: {}, snapshot, level: 4 });
      expect(result.ok).toBe(true);
      const json = JSON.stringify(result);
      expect(json).not.toMatch(/@/); // no e-mail addresses anywhere in tool output
      expect(json).not.toMatch(/\b(?:\+91|91)?[6-9]\d{9}\b/); // no Indian phone numbers
    }
  });

  it('labels the evidence basis on every reported figure', () => {
    const result = runTool({ name: 'getVerifiedSalesMetrics', input: {}, snapshot, level: 4 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { metrics: Array<{ basis: string }> };
      expect(data.metrics.length).toBeGreaterThan(0);
      for (const metric of data.metrics) {
        expect(['VERIFIED', 'DERIVED', 'ESTIMATE', 'UNKNOWN']).toContain(metric.basis);
      }
    }
  });

  it('exposes launch blockers with the owner action attached', () => {
    const result = runTool({ name: 'getLaunchReadiness', input: {}, snapshot: makeEmptyStoreSnapshot(), level: 4 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { blockers: Array<{ id: string; ownerAction: string }> };
      const payments = data.blockers.find((b) => b.id === 'payments-configured');
      expect(payments?.ownerAction).toMatch(/RAZORPAY_KEY_ID/);
    }
  });

  it('filters recommendations by category and priority', () => {
    const all = runTool({ name: 'getRecommendations', input: {}, snapshot: makeEmptyStoreSnapshot(), level: 4 });
    const filtered = runTool({
      name: 'getRecommendations',
      input: { category: 'READINESS', maxPriority: 2, limit: 5 },
      snapshot: makeEmptyStoreSnapshot(),
      level: 4,
    });
    expect(all.ok && filtered.ok).toBe(true);
    if (all.ok && filtered.ok) {
      const allRecs = all.data as Array<{ category: string; priority: number }>;
      const recs = filtered.data as Array<{ category: string; priority: number }>;
      expect(recs.length).toBeLessThan(allRecs.length);
      for (const rec of recs) {
        expect(rec.category).toBe('READINESS');
        expect(rec.priority).toBeLessThanOrEqual(2);
      }
    }
  });

  it('declares every tool read-only with no side effects', () => {
    for (const tool of Object.values(TOOLS)) {
      expect(tool.sideEffects).toBe('NONE');
      expect(tool.minLevel).toBeGreaterThanOrEqual(2);
    }
  });

  it('is deterministic for a fixed snapshot', () => {
    const a = runTool({ name: 'getStoreHealth', input: {}, snapshot, level: 4 });
    const b = runTool({ name: 'getStoreHealth', input: {}, snapshot, level: 4 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
