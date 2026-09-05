import { apiRoute, jsonOk, badRequest, ApiError } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { auditLog } from '@/lib/audit';
import { randomCode } from '@/lib/crypto';
import { assertRateLimit } from '@/lib/rate-limit';
import fs from 'node:fs/promises';
import path from 'node:path';

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
 * (original name discarded), images-only directory, nosniff headers on
 * /uploads/* (next.config). NOTE: single-server deployments store files on
 * local disk; serverless deployments should use object storage/Cloudinary
 * (documented in SETUP_CHECKLIST.md).
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
  const uploadDir = path.join(process.cwd(), 'public', 'uploads');
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, filename), buffer);

  await auditLog({
    actor: { id: admin.id, email: admin.email },
    action: 'upload.image',
    entityType: 'Upload',
    entityId: filename,
    data: { bytes: file.size, mime: detected.mime },
    req,
  });
  return jsonOk(
    { url: `/uploads/${filename}`, mime: detected.mime, bytes: file.size },
    { status: 201 }
  );
});
