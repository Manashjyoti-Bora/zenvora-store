/**
 * E2E environment loader — MUST be the first import in every e2e spec.
 *
 * tests/setup.ts loads `.env.test` (isolated test database). E2E specs instead
 * run against the real `npm run dev` server and its development database, so we
 * re-load `.env` with override BEFORE any `@/lib/db` import resolves
 * DATABASE_URL. Never point E2E at production: this file only ever reads the
 * local `.env`.
 */
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), override: true });

export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100';

export const e2eAdmin = {
  email: process.env.ADMIN_EMAIL ?? '',
  password: process.env.ADMIN_PASSWORD ?? '',
};
