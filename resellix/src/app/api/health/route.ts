import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { describePaymentProvider } from '@/lib/payments';
import { getEmailProvider } from '@/lib/notifications/providers';

export const dynamic = 'force-dynamic';

/**
 * Public liveness/readiness probe. Exposes NO secrets - only boolean states.
 * Used by uptime monitors and the admin health page.
 */
export async function GET(): Promise<Response> {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }

  const provider = describePaymentProvider();
  const emailProvider = getEmailProvider();
  const healthy = db;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        database: db,
        paymentsConfigured: provider.kind !== 'NONE',
        paymentsProvider: provider.kind,
        paymentsTestMode: provider.isTest,
        // Non-secret email diagnostics: provider NAME + configured flag only
        // (never hosts, users or credentials). Tells operators whether mail
        // goes to a real SMTP service or just to server logs (console).
        emailProvider: emailProvider.name,
        emailConfigured: emailProvider.isConfigured(),
        environment: env.NODE_ENV,
      },
    },
    { status: healthy ? 200 : 503 }
  );
}
