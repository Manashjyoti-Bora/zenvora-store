import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudinaryStorageProvider } from '@/lib/storage/cloudinary';
import { S3StorageProvider } from '@/lib/storage/s3';
import { LocalStorageProvider } from '@/lib/storage/local';
import { getStorageProvider, resetStorageProviderCache } from '@/lib/storage';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetStorageProviderCache();
});

describe('storage provider selection', () => {
  it('defaults to local', () => {
    expect(getStorageProvider().name).toBe('local');
  });

  it('falls back to local with s3 misconfigured', () => {
    vi.stubEnv('STORAGE_PROVIDER', 's3');
    resetStorageProviderCache();
    expect(getStorageProvider().name).toBe('local');
  });

  it('selects s3 when fully configured', () => {
    vi.stubEnv('STORAGE_PROVIDER', 's3');
    vi.stubEnv('S3_BUCKET', 'b');
    vi.stubEnv('S3_REGION', 'r');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'k');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 's');
    resetStorageProviderCache();
    expect(getStorageProvider().name).toBe('s3');
  });
});

describe('local provider', () => {
  it('puts and removes a file under public/uploads', async () => {
    const p = new LocalStorageProvider();
    const obj = await p.put({ buffer: Buffer.from('x'.repeat(10)), filename: 'unit-test.png', mime: 'image/png' });
    expect(obj.url).toBe('/uploads/unit-test.png');
    expect(fs.existsSync(path.join(process.cwd(), 'public/uploads/unit-test.png'))).toBe(true);
    await p.remove('unit-test.png');
    expect(fs.existsSync(path.join(process.cwd(), 'public/uploads/unit-test.png'))).toBe(false);
  });
});

describe('s3 provider (SigV4, no SDK)', () => {
  function stub() {
    vi.stubEnv('STORAGE_PROVIDER', 's3');
    vi.stubEnv('S3_BUCKET', 'zenvora-img');
    vi.stubEnv('S3_REGION', 'ap-south-1');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'AKIAEXAMPLE');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'secret123');
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return new Response('', { status: 200 });
      })
    );
    return calls;
  }

  it('signs PUT with AWS4-HMAC-SHA256 and returns the public URL', async () => {
    const calls = stub();
    const p = new S3StorageProvider();
    const obj = await p.put({ buffer: Buffer.from('abc'), filename: 'f1.png', mime: 'image/png' });
    expect(obj.url).toContain('zenvora-img');
    expect(obj.key).toBe('uploads/f1.png');
    const auth = String((calls[0].init!.headers as Record<string, string>).Authorization);
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/ap-south-1\/s3\/aws4_request/);
    expect(auth).toContain('SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date');
    expect(calls[0].url).toBe('https://zenvora-img.s3.ap-south-1.amazonaws.com/uploads/f1.png');
  });

  it('sends a valid x-amz-date and content sha256 on every request', async () => {
    const calls = stub();
    const p = new S3StorageProvider();
    await p.put({ buffer: Buffer.from('abc'), filename: 'f2.png', mime: 'image/png' });
    const headers = calls[0].init!.headers as Record<string, string>;
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    // sha256 of 'abc'
    expect(headers['x-amz-content-sha256']).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('signs DELETE and tolerates 404', async () => {
    const calls = stub();
    const p = new S3StorageProvider();
    await p.remove('uploads/gone.png');
    expect(calls[0].init!.method).toBe('DELETE');
    expect(String((calls[0].init!.headers as Record<string, string>).Authorization)).toContain('AWS4-HMAC-SHA256');
  });
});

describe('cloudinary provider', () => {
  it('signs upload params with sha1(sorted params + secret)', async () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'demo-cloud');
    vi.stubEnv('CLOUDINARY_API_KEY', 'ck');
    vi.stubEnv('CLOUDINARY_API_SECRET', 'cs');
    let sent: FormData | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        sent = init!.body as FormData;
        return new Response(JSON.stringify({ secure_url: 'https://res.cloudinary.com/x/f.png', public_id: 'zenvora/f' }), { status: 200 });
      })
    );
    const p = new CloudinaryStorageProvider();
    const obj = await p.put({ buffer: Buffer.from('abc'), filename: 'f.png', mime: 'image/png' });
    expect(obj.url).toBe('https://res.cloudinary.com/x/f.png');
    const fields: Record<string, string> = {};
    sent!.forEach((v, k) => {
      if (typeof v === 'string') fields[k] = v;
    });
    const payload = Object.keys(fields)
      .filter((k) => k !== 'signature' && k !== 'api_key' && k !== 'file')
      .sort()
      .map((k) => `${k}=${fields[k]}`)
      .join('&');
    expect(fields.signature).toBe(crypto.createHash('sha1').update(payload + 'cs').digest('hex'));
  });
});
