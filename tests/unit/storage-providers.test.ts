import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { CloudinaryStorageProvider } from '@/lib/storage/cloudinary';
import { S3StorageProvider } from '@/lib/storage/s3';
import { LocalStorageProvider } from '@/lib/storage/local';
import { getStorageProvider, resetStorageProviderCache } from '@/lib/storage';
import { StorageNotConfiguredError } from '@/lib/storage/types';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetStorageProviderCache();
});

describe('storage provider selection', () => {
  it('defaults to local only outside Production', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('STORAGE_PROVIDER', '');
    expect(getStorageProvider().name).toBe('local');
  });

  it('fails closed instead of falling back when S3 is misconfigured', () => {
    vi.stubEnv('STORAGE_PROVIDER', 's3');
    expect(() => getStorageProvider()).toThrow(StorageNotConfiguredError);
    expect(() => getStorageProvider()).toThrow(/S3_BUCKET/);
  });

  it('fails closed instead of falling back when Cloudinary is misconfigured', () => {
    vi.stubEnv('STORAGE_PROVIDER', 'cloudinary');
    expect(() => getStorageProvider()).toThrow(StorageNotConfiguredError);
    expect(() => getStorageProvider()).toThrow(/CLOUDINARY_API_KEY/);
  });

  it('refuses ephemeral local storage in Production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STORAGE_PROVIDER', 'local');
    expect(() => getStorageProvider()).toThrow(/Durable storage is required/);
  });

  it('selects S3 only when fully configured', () => {
    stubS3Env();
    vi.stubEnv('STORAGE_PROVIDER', 's3');
    resetStorageProviderCache();
    expect(getStorageProvider().name).toBe('s3');
  });
});

describe('local provider', () => {
  it('puts and removes a file under public/uploads', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const provider = new LocalStorageProvider();
    const obj = await provider.put({
      buffer: Buffer.from('x'.repeat(10)),
      filename: 'unit-test.png',
      mime: 'image/png',
    });
    expect(obj.url).toBe('/uploads/unit-test.png');
    expect(fs.existsSync(path.join(process.cwd(), 'public/uploads/unit-test.png'))).toBe(true);
    await provider.remove('unit-test.png');
    expect(fs.existsSync(path.join(process.cwd(), 'public/uploads/unit-test.png'))).toBe(false);
  });

  it('resolves only managed uploads for deletion and rejects traversal', () => {
    const provider = new LocalStorageProvider();
    expect(provider.keyFromTarget('/uploads/p-123-ABCDEFGH.png')).toBe('p-123-ABCDEFGH.png');
    expect(provider.keyFromTarget('https://cdn.example.test/uploads/p-123-ABCDEFGH.webp')).toBe(
      'p-123-ABCDEFGH.webp'
    );
    expect(provider.keyFromTarget('/uploads/seed/demo.svg')).toBeNull();
    expect(provider.keyFromTarget('../.env')).toBeNull();
    expect(provider.keyFromTarget('p-123-ABCDEFGH.png/extra')).toBeNull();
  });
});

function stubS3Env(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    S3_BUCKET: 'zenvora-img',
    S3_REGION: 'ap-south-1',
    S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
    S3_SECRET_ACCESS_KEY: 'secret123',
    S3_ENDPOINT: '',
    S3_PUBLIC_BASE_URL: '',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

function stubS3Fetch(status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response('', { status });
    })
  );
  return calls;
}

describe('S3 provider (SigV4, no SDK, mocked network)', () => {
  it('signs AWS PUT and returns the persistent public URL', async () => {
    stubS3Env();
    const calls = stubS3Fetch();
    const provider = new S3StorageProvider();
    const obj = await provider.put({
      buffer: Buffer.from('abc'),
      filename: 'f1.png',
      mime: 'image/png',
    });
    expect(obj.url).toBe('https://zenvora-img.s3.ap-south-1.amazonaws.com/uploads/f1.png');
    expect(obj.key).toBe('uploads/f1.png');
    const auth = String((calls[0]!.init!.headers as Record<string, string>).Authorization);
    expect(auth).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/ap-south-1\/s3\/aws4_request/
    );
    expect(auth).toContain('SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date');
    expect(calls[0]!.url).toBe('https://zenvora-img.s3.ap-south-1.amazonaws.com/uploads/f1.png');
    expect(calls[0]!.init!.signal).toBeDefined();
  });

  it('uses path-style R2 requests and an independent HTTPS public base', async () => {
    stubS3Env({
      S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      S3_PUBLIC_BASE_URL: 'https://media.example.com/',
    });
    const calls = stubS3Fetch();
    const provider = new S3StorageProvider();
    const obj = await provider.put({
      buffer: Buffer.from('abc'),
      filename: 'p-123-ABCDEFGH.png',
      mime: 'image/png',
    });
    expect(calls[0]!.url).toBe(
      'https://account.r2.cloudflarestorage.com/zenvora-img/uploads/p-123-ABCDEFGH.png'
    );
    expect(obj.url).toBe('https://media.example.com/uploads/p-123-ABCDEFGH.png');
    expect((calls[0]!.init!.headers as Record<string, string>).host).toBe(
      'account.r2.cloudflarestorage.com'
    );
  });

  it('requires a public base with a custom endpoint', () => {
    stubS3Env({ S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com' });
    const provider = new S3StorageProvider();
    expect(provider.isConfigured()).toBe(false);
    expect(provider.configurationIssue()).toMatch(/S3_PUBLIC_BASE_URL is required/);
  });

  it('sends a valid x-amz-date and content sha256 on every request', async () => {
    stubS3Env();
    const calls = stubS3Fetch();
    const provider = new S3StorageProvider();
    await provider.put({ buffer: Buffer.from('abc'), filename: 'f2.png', mime: 'image/png' });
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers['x-amz-content-sha256']).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('signs DELETE and tolerates an already-missing object', async () => {
    stubS3Env();
    const calls = stubS3Fetch(404);
    const provider = new S3StorageProvider();
    await provider.remove('uploads/p-123-ABCDEFGH.png');
    expect(calls[0]!.init!.method).toBe('DELETE');
    expect(String((calls[0]!.init!.headers as Record<string, string>).Authorization)).toContain(
      'AWS4-HMAC-SHA256'
    );
  });

  it('fails the upload on a non-2xx response without returning a URL', async () => {
    stubS3Env();
    stubS3Fetch(403);
    const provider = new S3StorageProvider();
    await expect(
      provider.put({ buffer: Buffer.from('abc'), filename: 'f3.png', mime: 'image/png' })
    ).rejects.toThrow('S3 PUT failed with HTTP 403');
  });

  it('limits route-resolved deletion to managed upload keys', () => {
    stubS3Env();
    const provider = new S3StorageProvider();
    expect(provider.keyFromTarget('uploads/p-123-ABCDEFGH.png')).toBe('uploads/p-123-ABCDEFGH.png');
    expect(provider.keyFromTarget('https://media.example.com/uploads/p-123-ABCDEFGH.png')).toBe(
      'uploads/p-123-ABCDEFGH.png'
    );
    expect(provider.keyFromTarget('uploads/supplier/image.png')).toBeNull();
    expect(provider.keyFromTarget('../credentials')).toBeNull();
  });
});

function stubCloudinaryEnv() {
  vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'demo-cloud');
  vi.stubEnv('CLOUDINARY_API_KEY', 'ck');
  vi.stubEnv('CLOUDINARY_API_SECRET', 'cs');
  vi.stubEnv('CLOUDINARY_FOLDER', 'zenvora');
}

describe('Cloudinary provider (mocked network)', () => {
  it('signs upload params with sha1(sorted params + secret)', async () => {
    stubCloudinaryEnv();
    let sent: FormData | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        sent = init!.body as FormData;
        return new Response(
          JSON.stringify({
            secure_url: 'https://res.cloudinary.com/demo-cloud/image/upload/v1/zenvora/f.png',
            public_id: 'zenvora/f',
          }),
          { status: 200 }
        );
      })
    );
    const provider = new CloudinaryStorageProvider();
    const obj = await provider.put({
      buffer: Buffer.from('abc'),
      filename: 'f.png',
      mime: 'image/png',
    });
    expect(obj.url).toContain('https://res.cloudinary.com/');
    const fields: Record<string, string> = {};
    sent!.forEach((v, k) => {
      if (typeof v === 'string') fields[k] = v;
    });
    const payload = Object.keys(fields)
      .filter((k) => k !== 'signature' && k !== 'api_key' && k !== 'file')
      .sort()
      .map((k) => `${k}=${fields[k]}`)
      .join('&');
    expect(fields.signature).toBe(
      crypto
        .createHash('sha1')
        .update(payload + 'cs')
        .digest('hex')
    );
    expect(fields.overwrite).toBe('false');
  });

  it('rejects an unexpected public_id instead of storing an unverifiable reference', async () => {
    stubCloudinaryEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              secure_url: 'https://res.cloudinary.com/x/f.png',
              public_id: 'other/f',
            }),
            { status: 200 }
          )
      )
    );
    const provider = new CloudinaryStorageProvider();
    await expect(
      provider.put({ buffer: Buffer.from('abc'), filename: 'f.png', mime: 'image/png' })
    ).rejects.toThrow('unexpected public_id');
  });

  it('confirms deletes and accepts only the exact managed public_id from the route', async () => {
    stubCloudinaryEnv();
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(init!);
        return new Response(JSON.stringify({ result: 'ok' }), { status: 200 });
      })
    );
    const provider = new CloudinaryStorageProvider();
    const key = 'zenvora/p-123-ABCDEFGH';
    expect(provider.keyFromTarget(key)).toBe(key);
    expect(provider.keyFromTarget('other/p-123-ABCDEFGH')).toBeNull();
    expect(
      provider.keyFromTarget('https://res.cloudinary.com/x/upload/v1/zenvora/p-123-ABCDEFGH.png')
    ).toBeNull();
    await provider.remove(key);
    expect(String(calls[0]!.body)).toContain(`public_id=${encodeURIComponent(key)}`);
  });

  it('fails non-2xx uploads without returning a URL', async () => {
    stubCloudinaryEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 }))
    );
    const provider = new CloudinaryStorageProvider();
    await expect(
      provider.put({ buffer: Buffer.from('abc'), filename: 'f.png', mime: 'image/png' })
    ).rejects.toThrow('Cloudinary upload failed with HTTP 401');
  });
});
