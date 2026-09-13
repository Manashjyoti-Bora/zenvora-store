import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { importProductsCsv } from '@/lib/catalog/import';
import { z } from 'zod';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const importSchema = z.object({
  csv: z.string().min(10).max(2_000_000),
});

export const POST = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = importSchema.parse(raw);

  const summary = await importProductsCsv(body.csv, { id: admin.id, email: admin.email });
  return jsonOk(summary);
});
