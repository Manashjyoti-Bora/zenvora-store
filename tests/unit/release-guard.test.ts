import { describe, it, expect } from 'vitest';
import { evaluateMarker, normaliseDbHost } from '../../scripts/release';

/**
 * Release-safety guard (scripts/release.ts): a build must never migrate or
 * ship against a database that belongs to a different environment on the
 * same host, while Neon branch forks (different endpoint host) are allowed.
 */
describe('normaliseDbHost', () => {
  it('strips the Neon pooler suffix so pooled and direct URLs of one branch match', () => {
    expect(
      normaliseDbHost('postgresql://u:p@ep-cool-sky-123456-pooler.ap-southeast-1.aws.neon.tech/db')
    ).toBe('ep-cool-sky-123456.ap-southeast-1.aws.neon.tech');
    expect(
      normaliseDbHost(
        'postgresql://u:p@ep-cool-sky-123456.ap-southeast-1.aws.neon.tech/db?sslmode=require'
      )
    ).toBe('ep-cool-sky-123456.ap-southeast-1.aws.neon.tech');
  });

  it('lower-cases hosts and keeps non-Neon hosts untouched', () => {
    expect(normaliseDbHost('postgres://ci:ci@127.0.0.1:5432/resellix_ci?schema=public')).toBe(
      '127.0.0.1'
    );
    expect(normaliseDbHost('postgresql://u:p@DB.Example.COM/x')).toBe('db.example.com');
  });

  it('returns null for garbage (never throws, never echoes the value)', () => {
    expect(normaliseDbHost('not a url')).toBeNull();
    expect(normaliseDbHost('')).toBeNull();
  });
});

describe('evaluateMarker', () => {
  const prodHost = 'ep-prod-111111.aws.neon.tech';
  const previewHost = 'ep-preview-222222.aws.neon.tech';

  it('claims an unmarked database', () => {
    expect(evaluateMarker(null, { environment: 'production', databaseHost: prodHost }).action).toBe(
      'claim'
    );
  });

  it('accepts a database already claimed by the same environment', () => {
    expect(
      evaluateMarker(
        { environment: 'preview', databaseHost: previewHost },
        { environment: 'preview', databaseHost: previewHost }
      ).action
    ).toBe('ok');
  });

  it('REFUSES a preview build whose DATABASE_URL points at the production database', () => {
    const verdict = evaluateMarker(
      { environment: 'production', databaseHost: prodHost },
      { environment: 'preview', databaseHost: prodHost }
    );
    expect(verdict.action).toBe('refuse');
    expect(verdict.reason).toMatch(/already claimed by the "production"/);
  });

  it('REFUSES a production build that was given the preview branch credentials', () => {
    expect(
      evaluateMarker(
        { environment: 'preview', databaseHost: previewHost },
        { environment: 'production', databaseHost: previewHost }
      ).action
    ).toBe('refuse');
  });

  it('re-claims a Neon branch forked from production (different endpoint host)', () => {
    const verdict = evaluateMarker(
      { environment: 'production', databaseHost: prodHost },
      { environment: 'preview', databaseHost: previewHost }
    );
    expect(verdict.action).toBe('reclaim-fork');
  });

  it('refuses a local build pointed at a shared environment database', () => {
    expect(
      evaluateMarker(
        { environment: 'preview', databaseHost: previewHost },
        { environment: 'local', databaseHost: previewHost }
      ).action
    ).toBe('refuse');
  });
});
