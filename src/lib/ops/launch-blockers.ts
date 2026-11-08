import type { StoreSettings } from '@/lib/settings';
import { isPlaceholderEmail } from '@/lib/support-email';
import {
  cloudinaryConfigurationIssue,
  s3ConfigurationIssue,
  type CloudinaryConfigurationEnv,
  type S3ConfigurationEnv,
} from '@/lib/storage/configuration';

/**
 * Launch blockers and configuration gaps, derived from stored settings and
 * the validated environment. Pure: both admin pages (Health, Operations)
 * call this so they never disagree. Nothing here is a legal determination;
 * see docs/LAUNCH_READINESS.md for the owner-facing checklist.
 */
export interface LaunchReadiness {
  /** Must be fixed before real customers pay. */
  blockers: string[];
  /** Should be fixed; the store functions honestly without them. */
  configGaps: string[];
}

export interface LaunchReadinessEnv extends S3ConfigurationEnv, CloudinaryConfigurationEnv {
  NODE_ENV: string;
  EMAIL_PROVIDER: string;
  CRON_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  STORAGE_PROVIDER: string;
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_ENDPOINT?: string;
  S3_PUBLIC_BASE_URL?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  CLOUDINARY_CLOUD_NAME?: string;
  CLOUDINARY_API_KEY?: string;
  CLOUDINARY_API_SECRET?: string;
  SUPPORT_EMAIL?: string;
}

export function collectLaunchReadiness(params: {
  settings: Pick<StoreSettings, 'demoMode' | 'supportEmail' | 'business'>;
  env: LaunchReadinessEnv;
  razorpayConfigured: boolean;
  isProduction?: boolean;
}): LaunchReadiness {
  const { settings, env, razorpayConfigured } = params;
  const isProduction = params.isProduction ?? env.NODE_ENV === 'production';
  const blockers: string[] = [];
  const configGaps: string[] = [];

  if (isProduction && !razorpayConfigured) blockers.push('Razorpay credentials not configured');
  if (isProduction && env.EMAIL_PROVIDER !== 'smtp')
    blockers.push('Email provider is console — customers would not receive emails');
  if (settings.demoMode && isProduction) blockers.push('Demo mode is ON in production');
  const storageIssue = isProduction ? productionStorageIssue(env) : null;
  if (storageIssue) blockers.push(storageIssue);
  if (!env.CRON_SECRET)
    blockers.push('CRON_SECRET not set — /api/cron/jobs is unprotected or disabled');
  if (isPlaceholderEmail(settings.supportEmail))
    blockers.push(
      'Support e-mail is still the placeholder (support@example.com) — set a real address in Settings → Store or the SUPPORT_EMAIL environment variable; public pages link to the contact form until then'
    );

  const b = settings.business;
  const missingBusiness = [
    !b.legalName && 'legal/trading name',
    !b.addressLine && 'principal address',
    !b.gstin && 'GSTIN (if registered)',
  ].filter((x): x is string => Boolean(x));
  if (missingBusiness.length)
    configGaps.push(
      `Business details missing: ${missingBusiness.join(', ')} — required on policy pages by the Consumer Protection (E-Commerce) Rules once selling`
    );
  if (razorpayConfigured && !env.RAZORPAY_WEBHOOK_SECRET)
    configGaps.push(
      'RAZORPAY_WEBHOOK_SECRET not set — webhook confirmations are rejected; only browser-verified payments confirm'
    );
  if (
    !isPlaceholderEmail(settings.supportEmail) &&
    env.SUPPORT_EMAIL &&
    settings.supportEmail === env.SUPPORT_EMAIL
  )
    configGaps.push(
      'Support e-mail comes from the SUPPORT_EMAIL environment fallback — save it in Settings → Store to make it permanent'
    );

  return { blockers, configGaps };
}

function productionStorageIssue(env: LaunchReadinessEnv): string | null {
  if (env.STORAGE_PROVIDER === 'local') {
    return 'Durable storage is not configured — Production uploads are disabled because local disk is ephemeral';
  }
  if (env.STORAGE_PROVIDER === 's3') {
    const issue = s3ConfigurationIssue(env);
    return issue ? `${issue} — Production uploads are disabled` : null;
  }
  if (env.STORAGE_PROVIDER === 'cloudinary') {
    const issue = cloudinaryConfigurationIssue(env);
    return issue ? `${issue} — Production uploads are disabled` : null;
  }
  return 'STORAGE_PROVIDER is invalid — Production uploads are disabled';
}
