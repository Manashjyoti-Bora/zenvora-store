import './env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { describePaymentProvider } from '@/lib/payments';
import {
  publicPaymentFaqAnswer,
  publicPaymentMethodLabel,
  publicPaymentTrustLabel,
} from '@/lib/payments/public-messaging';
import { getSettings } from '@/lib/settings';

import { HttpAgent, waitForServer } from './http';

/** Public HTTP regression coverage; no browser or real gateway is involved. */
const agent = new HttpAgent();
const payments = describePaymentProvider();
let productSlug: string;
let codEnabled: boolean;

beforeAll(async () => {
  await waitForServer();
  const [product, settings] = await Promise.all([
    prisma.product.findFirst({ where: { status: 'ACTIVE' }, select: { slug: true } }),
    getSettings(),
  ]);
  if (!product) throw new Error('E2E requires a seeded active product');
  productSlug = product.slug;
  codEnabled = settings.shipping.codEnabled;
  await agent.get('/api/health');
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('provider-aware public payment messaging', () => {
  it('home and product pages use the same provider/COD source of truth', async () => {
    const [home, product] = await Promise.all([
      agent.get('/'),
      agent.get(`/products/${productSlug}`),
    ]);
    expect(home.status).toBe(200);
    expect(product.status).toBe(200);
    const state = { provider: payments.kind, codEnabled };
    expect(home.body).toContain(publicPaymentTrustLabel(state));
    expect(product.body).toContain(publicPaymentMethodLabel(state));

    if (payments.kind === 'NONE') {
      expect(product.body).not.toContain('Online + COD');
      expect(product.body).not.toContain('Online + Cash on Delivery');
      expect(home.body).not.toContain('Secure payments (being configured)');
    }
  });

  it('FAQ visible text and JSON-LD never contradict the configured provider', async () => {
    const res = await agent.get('/faq');
    expect(res.status).toBe(200);
    const answer = publicPaymentFaqAnswer({ provider: payments.kind, codEnabled });
    // The answer occurs in both the visible details and the structured-data mirror.
    expect(res.body.split(answer).length - 1).toBeGreaterThanOrEqual(2);

    if (payments.kind !== 'RAZORPAY') {
      expect(res.body).not.toContain('Online payment (UPI, cards, netbanking');
      expect(res.body).not.toContain('Online payment via UPI, cards and netbanking');
      expect(res.body).not.toContain('licensed payment gateway');
    }
    if (payments.kind === 'NONE') {
      expect(res.body).toContain('How is my order confirmed without online payment?');
      expect(res.body).not.toContain('Is my payment safe? What if money is debited');
    }
    if (payments.kind === 'TEST') {
      expect(res.body).toContain('Does the TEST payment simulator move real money?');
    }
  });

  it.each([
    '/about',
    '/policies/terms',
    '/policies/privacy',
    '/policies/returns',
    '/policies/shipping',
  ])('%s does not claim a live gateway when none is configured', async (path) => {
    const res = await agent.get(path);
    expect(res.status).toBe(200);
    if (payments.kind !== 'RAZORPAY') {
      expect(res.body).not.toContain('processed by licensed payment');
      expect(res.body).not.toContain('Online payments are processed by licensed');
      expect(res.body).not.toContain('UPI/cards/netbanking (bank processing times vary)');
    }
    if (payments.kind === 'TEST') {
      expect(res.body).toContain('TEST');
      expect(res.body).toContain('no real money moves');
    }
  });
});
