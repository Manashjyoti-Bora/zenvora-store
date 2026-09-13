import './env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';

import { e2eAdmin } from './env';
import { HttpAgent, okData, waitForServer } from './http';
import { createFixtureUser, loginFixture } from './fixtures';

/**
 * E2E — admin authorization & IDOR resistance over real HTTP.
 *
 * Proves: anonymous → 401, logged-in CUSTOMER → 403 on every sampled admin
 * API, admin → 200, and one user cannot touch another user's address book
 * (horizontal privilege escalation).
 */


// NOTE: only these admin API routes export GET (list pages are server-rendered
// with direct DB access, not JSON APIs). Authz is still proven on GET + POST + PATCH.
const ADMIN_GET_ENDPOINTS = ['/api/admin/settings', '/api/admin/reports/export'];

async function anyActiveProductId(): Promise<string> {
  const p = await prisma.product.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } });
  if (!p) throw new Error('E2E requires seeded products — run `npm run db:seed`');
  return p.id;
}

beforeAll(async () => {
  await waitForServer();
  if (!e2eAdmin.email || !e2eAdmin.password) throw new Error('ADMIN_EMAIL/ADMIN_PASSWORD missing from .env');
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('anonymous access to admin APIs', () => {
  it.each(ADMIN_GET_ENDPOINTS)('GET %s → 401', async (path) => {
    const anon = new HttpAgent();
    await anon.get('/api/health');
    const res = await anon.get(path);
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/products/:id → 401', async () => {
    const anon = new HttpAgent();
    await anon.get('/api/health');
    const res = await anon.get(`/api/admin/products/${await anyActiveProductId()}`);
    expect(res.status).toBe(401);
  });
});

describe('logged-in CUSTOMER must never reach admin APIs', () => {
  const customer = new HttpAgent();

  beforeAll(async () => {
    const user = await createFixtureUser('e2e-authz');
    const login = await loginFixture(customer, user);
    expect(login.status).toBe(200);
  });

  it.each(ADMIN_GET_ENDPOINTS)('GET %s → 403', async (path) => {
    const res = await customer.get(path);
    expect(res.status).toBe(403);
  });

  it('GET /api/admin/products/:id → 403', async () => {
    const res = await customer.get(`/api/admin/products/${await anyActiveProductId()}`);
    expect(res.status).toBe(403);
  });

  it('PATCH /api/admin/settings → 403', async () => {
    const res = await customer.patch('/api/admin/settings', { storeName: 'Hijacked' });
    expect(res.status).toBe(403);
  });

  it('POST /api/admin/products → 403', async () => {
    const res = await customer.post('/api/admin/products', { name: 'Ghost', slug: 'ghost' });
    expect(res.status).toBe(403);
  });

  it('POST /api/admin/jobs/run → 403 (cannot trigger background work)', async () => {
    const res = await customer.post('/api/admin/jobs/run', {});
    expect(res.status).toBe(403);
  });

  it('POST /api/admin/users → 403', async () => {
    const res = await customer.post('/api/admin/users', { email: 'attacker@e2e.example', role: 'ADMIN' });
    expect(res.status).toBe(403);
  });

  it('GET /admin page turns a customer away toward /account (role gate in layout)', async () => {
    const res = await customer.get('/admin');
    // Production SSR answers 307; the dev server may stream a 200 shell whose
    // RSC payload carries the redirect. Litmus either way: the admin layout's
    // own sidebar label ("Admin panel") must never render for a customer.
    expect(res.body).not.toMatch(/Admin panel/i);
    if (res.status !== 200) {
      expect([302, 307]).toContain(res.status);
      expect(res.location()).toMatch(/\/account/);
    }
  });
});

describe('ADMIN access works with seeded admin credentials from .env', () => {
  const admin = new HttpAgent();

  beforeAll(async () => {
    await admin.get('/api/health');
    const login = await admin.post('/api/auth/login', { email: e2eAdmin.email, password: e2eAdmin.password });
    expect(login.status, `admin login failed: ${login.body.slice(0, 200)}`).toBe(200);
  });

  it.each(ADMIN_GET_ENDPOINTS)('GET %s → 200', async (path) => {
    const res = await admin.get(path);
    expect(res.status).toBe(200);
  });

  it('GET /api/admin/products/:id → 200 with the product', async () => {
    const res = await admin.get(`/api/admin/products/${await anyActiveProductId()}`);
    expect(res.status).toBe(200);
    expect(okData<{ product?: { id?: string } }>(res)?.product?.id).toBeTruthy();
  });

  it('GET /admin page renders for admin (no redirect)', async () => {
    const res = await admin.get('/admin');
    expect(res.status).toBe(200);
  });

  it('PATCH /api/admin/settings accepts an admin update and persists it', async () => {
    const before = await admin.get('/api/admin/settings');
    const current = okData<{ settings?: { storeName?: string } }>(before)?.settings?.storeName;
    expect(typeof current).toBe('string');

    const res = await admin.patch('/api/admin/settings', { storeName: current }); // same-value patch: safe, still exercises authz + write path
    expect(res.status).toBe(200);
    const after = okData<{ settings?: { storeName?: string } }>(res);
    expect(after?.settings?.storeName).toBe(current);
  });
});

describe('IDOR — horizontal privilege escalation on the address book', () => {
  it('user B cannot PATCH or DELETE user A address', async () => {
    const ownerA = await createFixtureUser('e2e-idor-a');
    const userA = new HttpAgent();
    expect((await loginFixture(userA, ownerA)).status).toBe(200);
    const created = await userA.post('/api/account/addresses', {
      fullName: 'Address Owner',
      phone: '9876543211',
      line1: '42 Secret Lane',
      city: 'Guwahati',
      state: 'Assam',
      postalCode: '781002',
      country: 'IN',
    });
    expect(created.status).toBe(201);
    const addressId = okData<{ address?: { id?: string } }>(created)?.address?.id;
    expect(addressId).toBeTruthy();

    const ownerB = await createFixtureUser('e2e-idor-b');
    const userB = new HttpAgent();
    expect((await loginFixture(userB, ownerB)).status).toBe(200);

    const patch = await userB.patch(`/api/account/addresses/${addressId}`, { city: 'Hacked' });
    expect(patch.status).toBe(403);

    const del = await userB.del(`/api/account/addresses/${addressId}`);
    expect(del.status).toBe(403);

    // Owner can still see the untouched address.
    const list = await userA.get('/api/account/addresses');
    expect(list.status).toBe(200);
    const row = (okData<{ addresses?: { id: string; city: string }[] }>(list)?.addresses ?? []).find((a) => a.id === addressId);
    expect(row?.city).toBe('Guwahati');
  });
});
