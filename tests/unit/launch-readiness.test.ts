import { describe, expect, it } from 'vitest';
import { collectLaunchReadiness } from '@/lib/ops/launch-blockers';

const business = { legalName: '', gstin: '', addressLine: '', city: '', state: '', postalCode: '' };
const prodEnv = {
  NODE_ENV: 'production',
  EMAIL_PROVIDER: 'smtp',
  CRON_SECRET: 'x',
  RAZORPAY_WEBHOOK_SECRET: undefined,
  STORAGE_PROVIDER: 'local',
  SUPPORT_EMAIL: 'owner@mailbox.test',
};

describe('collectLaunchReadiness', () => {
  it('flags the shipped placeholder support e-mail, demo mode and missing payments in production', () => {
    const r = collectLaunchReadiness({
      settings: { demoMode: true, supportEmail: 'support@example.com', business },
      env: prodEnv,
      razorpayConfigured: false,
    });
    expect(r.blockers).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Razorpay credentials/),
        expect.stringMatching(/Demo mode is ON/),
        expect.stringMatching(/placeholder/),
      ])
    );
    expect(r.configGaps.join(' ')).toMatch(
      /Business details missing: legal\/trading name, principal address, GSTIN/
    );
    expect(r.blockers.join(' ')).toMatch(/Durable storage is not configured/);
    expect(r.configGaps.join(' ')).not.toMatch(/STORAGE_PROVIDER is local/);
  });

  it('an env-fallback support address clears the blocker but is reported as a gap until saved', () => {
    const r = collectLaunchReadiness({
      settings: { demoMode: false, supportEmail: 'owner@mailbox.test', business },
      env: prodEnv,
      razorpayConfigured: true,
    });
    expect(r.blockers.join(' ')).not.toMatch(/placeholder|Demo mode|Razorpay credentials/);
    expect(r.configGaps).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/SUPPORT_EMAIL environment fallback/),
        expect.stringMatching(/RAZORPAY_WEBHOOK_SECRET/),
      ])
    );
  });

  it('is quiet when everything is configured', () => {
    const r = collectLaunchReadiness({
      settings: {
        demoMode: false,
        supportEmail: 'help@store.test',
        business: {
          ...business,
          legalName: 'Zenvora',
          addressLine: '1 Road',
          gstin: '18ABCDE1234F1Z5',
        },
      },
      env: {
        ...prodEnv,
        RAZORPAY_WEBHOOK_SECRET: 'w',
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: 'example-bucket',
        S3_REGION: 'ap-south-1',
        S3_ACCESS_KEY_ID: 'synthetic-key',
        S3_SECRET_ACCESS_KEY: 'synthetic-secret',
      },
      razorpayConfigured: true,
    });
    expect(r.blockers).toEqual([]);
    expect(r.configGaps).toEqual([]);
  });

  it('fails readiness closed for incomplete durable-storage credentials', () => {
    const r = collectLaunchReadiness({
      settings: { demoMode: false, supportEmail: 'owner@mailbox.test', business },
      env: { ...prodEnv, STORAGE_PROVIDER: 'cloudinary', CLOUDINARY_CLOUD_NAME: 'example' },
      razorpayConfigured: true,
    });
    expect(r.blockers.join(' ')).toMatch(/Cloudinary storage is missing/);
    expect(r.blockers.join(' ')).toMatch(/CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET/);
  });

  it('uses the provider public-URL validation as a launch blocker', () => {
    const r = collectLaunchReadiness({
      settings: { demoMode: false, supportEmail: 'owner@mailbox.test', business },
      env: {
        ...prodEnv,
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: 'example-bucket',
        S3_REGION: 'auto',
        S3_ACCESS_KEY_ID: 'synthetic-key',
        S3_SECRET_ACCESS_KEY: 'synthetic-secret',
        S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
        S3_PUBLIC_BASE_URL: 'http://localhost:9000',
      },
      razorpayConfigured: true,
    });
    expect(r.blockers.join(' ')).toMatch(/S3_PUBLIC_BASE_URL must be a public HTTPS URL/);
  });

  it('outside production only CRON_SECRET and the placeholder are blockers', () => {
    const r = collectLaunchReadiness({
      settings: { demoMode: true, supportEmail: 'support@example.com', business },
      env: {
        ...prodEnv,
        NODE_ENV: 'development',
        CRON_SECRET: undefined,
        EMAIL_PROVIDER: 'console',
      },
      razorpayConfigured: false,
    });
    expect(r.blockers).toHaveLength(2);
    expect(r.blockers.join(' ')).toMatch(/CRON_SECRET/);
  });
});
