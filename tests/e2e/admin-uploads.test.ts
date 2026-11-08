import './env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';

import { e2eAdmin } from './env';
import { HttpAgent, okData, waitForServer } from './http';
import { sessionAgentForEmail } from './fixtures';

/** Isolated HTTP upload tests: local CI disk + throw-away DB, no remote storage. */
let admin = new HttpAgent();
const uploads: Array<{ key: string; url: string }> = [];
const referenceIds: string[] = [];

// Valid 1x1 PNG; content is checked independently of its filename/MIME claim.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function pngForm(): FormData {
  const form = new FormData();
  form.append(
    'file',
    new File([new Uint8Array(ONE_PIXEL_PNG)], 'not-trusted.txt', { type: 'text/plain' })
  );
  return form;
}

beforeAll(async () => {
  await waitForServer();
  if (!e2eAdmin.email) throw new Error('Seeded ADMIN_EMAIL is required');
  admin = await sessionAgentForEmail(e2eAdmin.email);
}, 180_000);

afterAll(async () => {
  if (referenceIds.length) {
    await prisma.productImage.deleteMany({ where: { id: { in: referenceIds } } });
  }
  for (const upload of uploads) {
    await admin.del('/api/admin/uploads', { key: upload.key }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe('admin upload authorization and validation', () => {
  it('rejects anonymous uploads before writing a file', async () => {
    const anonymous = new HttpAgent();
    await anonymous.get('/api/health');
    const res = await anonymous.post('/api/admin/uploads', pngForm());
    expect(res.status).toBe(401);
  });

  it('rejects content that is not a supported image', async () => {
    const form = new FormData();
    form.append('file', new File(['not an image'], 'fake.png', { type: 'image/png' }));
    const res = await admin.post('/api/admin/uploads', form);
    expect(res.status).toBe(400);
  });

  it('stores a real image by content and returns its persistent URL/key metadata', async () => {
    const res = await admin.post('/api/admin/uploads', pngForm());
    expect(res.status, res.body).toBe(201);
    const stored = okData<{
      url: string;
      key: string;
      provider: string;
      persistent: boolean;
      bytes: number;
    }>(res);
    expect(stored).toBeDefined();
    expect(stored!.url).toMatch(/^\/uploads\/p-\d+-[A-Z0-9]+\.png$/);
    expect(stored!.key).toMatch(/^p-\d+-[A-Z0-9]+\.png$/);
    expect(stored!.provider).toBe('local');
    expect(stored!.persistent).toBe(false);
    expect(stored!.bytes).toBe(ONE_PIXEL_PNG.length);
    uploads.push({ key: stored!.key, url: stored!.url });
  });
});

describe('safe deletion and durable database references', () => {
  it('refuses unmanaged/traversal deletion targets', async () => {
    for (const key of ['../.env', 'seed/demo.svg', '/uploads/seed/demo.svg']) {
      const res = await admin.del('/api/admin/uploads', { key });
      expect(res.status).toBe(400);
    }
  });

  it('blocks deletion while a ProductImage references the URL, then allows detachment + delete', async () => {
    const upload = uploads[0];
    expect(upload).toBeDefined();
    const product = await prisma.product.findFirst({ select: { id: true } });
    if (!product) throw new Error('Seeded product required');
    const reference = await prisma.productImage.create({
      data: {
        productId: product.id,
        url: upload!.url,
        alt: 'Isolated upload reference test',
        position: 900,
        isPrimary: false,
      },
    });
    referenceIds.push(reference.id);

    const blocked = await admin.del('/api/admin/uploads', { key: upload!.key });
    expect(blocked.status).toBe(409);
    expect(
      await prisma.productImage.findUnique({ where: { id: reference.id }, select: { url: true } })
    ).toEqual({ url: upload!.url });

    await prisma.productImage.delete({ where: { id: reference.id } });
    const deleted = await admin.del('/api/admin/uploads', { key: upload!.key });
    expect(deleted.status, deleted.body).toBe(200);
    expect(okData<{ deleted: boolean; key: string }>(deleted)).toEqual({
      deleted: true,
      key: upload!.key,
    });
  });
});
