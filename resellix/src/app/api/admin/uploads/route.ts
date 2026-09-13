import { apiRoute, jsonOk, badRequest, ApiError } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { auditLog } from '@/lib/audit';
import { randomCode } from '@/lib/crypto';
import { assertRateLimit } from '@/lib/rate-limit';
import { getStorageProvider } from '@/lib/storage';

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
 * local disk (ephemeral on serverless - UI warns), S3-compatible object
 * storage or Cloudinary for persistence across deploys.
 */
export const POST = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  assertRateLimit(`upload:${admin.id}`, { limit: 60, windowMs: 15 * 60_000 });

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
  const provider = getStorageProvider();
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

/** Delete an uploaded image (admin). Accepts the provider key or a local URL. */
export const DELETE = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  const raw = (await req.json().catch(() => null)) as { key?: string; url?: string } | null;
  const target = raw?.key ?? raw?.url;
  if (!target) throw badRequest('Provide { key } or { url } of the upload to delete');

  const provider = getStorageProvider();
  const key = target.startsWith('http') || target.startsWith('/') ? extractKey(target) : target;
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

function extractKey(url: string): string {
  const path = url.startsWith('http') ? new URL(url).pathname : url;
  const idx = path.indexOf('/uploads/');
  if (idx >= 0) return `uploads/${path.slice(idx + '/uploads/'.length)}`;
  return path.split('/').pop() ?? path;
}
