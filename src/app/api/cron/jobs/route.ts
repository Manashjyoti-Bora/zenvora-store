import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { safeEqual } from '@/lib/crypto';
import { processDueJobs } from '@/lib/jobs/runner';
import { purgeExpiredSessions } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Cron entrypoint for reliable background processing.
 *
 * Protected by CRON_SECRET (Authorization: Bearer <CRON_SECRET>) so it can be
 * called by cron-job.org / Vercel Cron / GitHub Actions without exposing job
 * processing to the public. Also performs housekeeping (expired sessions,
 * abandoned carts).
 *
 * Recommended schedule: every 5 minutes.
 */
export async function POST(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) {
    logger.error('Cron called but CRON_SECRET is not configured');
    return NextResponse.json({ ok: false, error: 'Cron is not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !safeEqual(token, env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: 'Invalid cron secret' }, { status: 401 });
  }

  const stats = await processDueJobs({ limit: 25 });
  const sessionsPurged = await purgeExpiredSessions();
  const cartsPurged = await prisma.cart.deleteMany({
    where: { expiresAt: { lt: new Date() }, convertedOrderId: null, userId: null },
  });

  return NextResponse.json({
    ok: true,
    jobs: stats,
    housekeeping: { sessionsPurged, cartsPurged: cartsPurged.count },
  });
}
