import { apiRoute, jsonOk, badRequest, conflict, ApiError } from '@/lib/errors';
import { readJson } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { auditLog } from '@/lib/audit';
import { randomCode } from '@/lib/crypto';
import { assertRateLimit } from '@/lib/rate-limit';
import { getStorageProvider } from '@/lib/storage';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/** Magic-byte signatures - the extension is NEVER trusted. */
const SIGNATURES: Array<{ ext: string; mime: string; test: (b: Buffer) => boolean }> = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: 'png',
    mime: 'image/png',
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    ext: 'webp',
    mime: 'image/webp',
    test: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    ext: 'gif',
    mime: 'image/gif',
    test: (b) => b.subarray(0, 3).toString('ascii') === 'GIF',
  },
  {
    ext: 'avif',
    mime: 'image/avif',
    test: (b) => b.subarray(4, 12).toString('ascii') === 'ftypavif',
  },
];

/**
 * Admin-only image upload for product photos.
 * Hardening: type sniffing via magic bytes, size cap, random filename
 * (original name discarded), nosniff headers on served uploads.
 * Storage goes through the provider abstraction (STORAGE_PROVIDER):
 * local disk for development/test only, or durable S3/Cloudinary storage.
 * Production fails closed instead of using ephemeral local disk.
 */
export const POST = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  await assertRateLimit(`upload:${admin.id}`, { limit: 60, windowMs: 15 * 60_000 });

  const provider = getStorageProvider();
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw badRequest('No file provided (field name: "file")');
  if (file.size <= 0) throw badRequest('File is empty');
  if (file.size > MAX_BYTES) {
    throw new ApiError(
      413,
      `Image exceeds the ${MAX_BYTES / 1024 / 1024} MB limit`,
      'FILE_TOO_LARGE'
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = SIGNATURES.find((s) => s.test(buffer));
  if (!detected) {
    throw badRequest(
      'Only real JPEG, PNG, WEBP, GIF or AVIF images are allowed (file content was checked, not just the extension).'
    );
  }

  const filename = `p-${Date.now()}-${randomCode(8)}.${detected.ext}`;
  const stored = await provider.put({ buffer, filename, mime: detected.mime });

  await auditLog({
    actor: { id: admin.id, email: admin.email },
    action: 'upload.image',
    entityType: 'Upload',
    entityId: stored.key,
    data: { bytes: file.size, mime: detected.mime, provider: provider.name },
    req,
  });
  return jsonOk(
    {
      url: stored.url,
      key: stored.key,
      provider: provider.name,
      persistent: provider.persistent,
      mime: detected.mime,
      bytes: stored.bytes,
    },
    { status: 201 }
  );
});

/** Delete an unattached, app-managed upload (admin only). */
export const DELETE = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  await assertRateLimit(`upload-delete:${admin.id}`, { limit: 30, windowMs: 15 * 60_000 });
  const raw = (await readJson(req)) as { key?: unknown; url?: unknown } | null;
  const target = raw?.key ?? raw?.url;
  if (typeof target !== 'string' || !target || target.length > 2000) {
    throw badRequest('Provide a valid { key } or { url } of the upload to delete');
  }

  const provider = getStorageProvider();
  const key = provider.keyFromTarget(target);
  if (!key) {
    throw badRequest(
      'Refusing to delete an unmanaged object. Use the exact key returned for an app-uploaded product image.'
    );
  }
  const referenced = await prisma.productImage.findFirst({
    where: { url: { contains: key } },
    select: { id: true },
  });
  if (referenced) {
    throw conflict('Remove this image from every product before deleting the stored object.');
  }
  await provider.remove(key);

  await auditLog({
    actor: { id: admin.id, email: admin.email },
    action: 'upload.delete',
    entityType: 'Upload',
    entityId: key,
    data: { provider: provider.name },
    req,
  });
  return jsonOk({ deleted: true, key });
});
