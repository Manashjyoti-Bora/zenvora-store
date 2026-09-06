import { z } from 'zod';

/**
 * Centralised, validated environment configuration.
 * Every secret used by the application is read from here - never from
 * process.env scattered across the codebase, and never exposed to the client
 * except for keys explicitly prefixed with NEXT_PUBLIC_.
 */

const boolStr = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'))
  .default('false');

const optionalNonEmpty = (schema: z.ZodTypeAny) =>
  schema.optional().transform((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  APP_NAME: z.string().min(1).default('Resellix'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  ADMIN_EMAIL: optionalNonEmpty(z.string().email()),
  ADMIN_PASSWORD: optionalNonEmpty(z.string().min(8)),

  PAYMENTS_TEST_MODE: boolStr,
  RAZORPAY_KEY_ID: optionalNonEmpty(z.string()),
  RAZORPAY_KEY_SECRET: optionalNonEmpty(z.string()),
  NEXT_PUBLIC_RAZORPAY_KEY_ID: optionalNonEmpty(z.string()),
  RAZORPAY_WEBHOOK_SECRET: optionalNonEmpty(z.string()),

  SUPPLIER_DEMO_MODE: boolStr,
  SUPPLIER_WEBHOOK_SECRET: optionalNonEmpty(z.string()),

  CRON_SECRET: optionalNonEmpty(z.string()),

  EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  SMTP_HOST: optionalNonEmpty(z.string()),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: boolStr,
  SMTP_USER: optionalNonEmpty(z.string()),
  SMTP_PASS: optionalNonEmpty(z.string()),
  EMAIL_FROM: z.string().default('Resellix <no-reply@resellix.local>'),
  EMAIL_REPLY_TO: optionalNonEmpty(z.string()),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\nSee .env.example for guidance.`
    );
  }
  return parsed.data;
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDev = env.NODE_ENV === 'development';

/**
 * Razorpay is usable only when both key id and secret are present AND the key
 * prefix matches the environment:
 *  - TEST keys (rzp_test_…) are refused in production, so a live store can
 *    never route real customers through the sandbox by misconfiguration.
 *  - LIVE keys (rzp_live_…) are refused outside production, so real money can
 *    never move from development/test runs.
 * Returns null when the configuration is usable, otherwise the reason.
 */
export function razorpayConfigIssue(): string | null {
  const keyId = env.RAZORPAY_KEY_ID;
  const secret = env.RAZORPAY_KEY_SECRET;
  if (!keyId || !secret) {
    return 'Razorpay keys are not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)';
  }
  if (isProduction && keyId.startsWith('rzp_test_')) {
    return 'RAZORPAY_KEY_ID is a TEST key (rzp_test_…) while NODE_ENV=production — production refuses test credentials';
  }
  if (!isProduction && keyId.startsWith('rzp_live_')) {
    return 'RAZORPAY_KEY_ID is a LIVE key (rzp_live_…) while NODE_ENV is not production — live keys are refused outside production';
  }
  return null;
}

/** Razorpay is usable only when both key id and secret are present. */
export function isRazorpayConfigured(): boolean {
  return razorpayConfigIssue() === null;
}

/**
 * Test payment provider is allowed ONLY outside production. In production a
 * fake payment success must never be possible, even by misconfiguration:
 * this function is the single gate that enforces that rule.
 */
export function isTestPaymentsAllowed(): boolean {
  return env.PAYMENTS_TEST_MODE && !isProduction;
}

/** Demo supplier adapter gate - same rule as test payments. */
export function isDemoSupplierAllowed(): boolean {
  return env.SUPPLIER_DEMO_MODE && !isProduction;
}
