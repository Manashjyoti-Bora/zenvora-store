import crypto from 'node:crypto';
import { s3ConfigurationIssue, s3PublicBaseUrl } from './configuration';
import { StorageNotConfiguredError, type StorageObject, type StorageProvider } from './types';

const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;
const SAFE_OBJECT_KEY = /^uploads\/[A-Za-z0-9._-]+$/;
const MANAGED_OBJECT_KEY = /^uploads\/p-\d+-[A-Za-z0-9_-]+\.(?:jpg|png|webp|gif|avif)$/;
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * S3-compatible object storage using SigV4 without an SDK.
 * AWS uses virtual-hosted URLs. Custom endpoints (R2/MinIO) use path-style
 * API URLs and REQUIRE an explicit HTTPS public bucket/CDN base URL.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3' as const;
  readonly persistent = true;

  isConfigured(): boolean {
    return this.configurationIssue() === null;
  }

  configurationIssue(): string | null {
    return s3ConfigurationIssue(process.env);
  }

  private requireConfig(): void {
    const issue = this.configurationIssue();
    if (issue) throw new StorageNotConfiguredError(issue);
  }

  private publicBaseUrl(): string {
    return s3PublicBaseUrl(process.env);
  }

  private requestBaseUrl(): string {
    const bucket = process.env.S3_BUCKET as string;
    const region = process.env.S3_REGION as string;
    if (process.env.S3_ENDPOINT) {
      const endpoint = new URL(process.env.S3_ENDPOINT);
      return `${endpoint.protocol}//${endpoint.host}/${bucket}`;
    }
    return `https://${bucket}.s3.${region}.amazonaws.com`;
  }

  async put(params: { buffer: Buffer; filename: string; mime: string }): Promise<StorageObject> {
    this.requireConfig();
    if (!SAFE_FILENAME.test(params.filename) || params.filename.includes('..')) {
      throw new Error('Unsafe storage filename');
    }
    const key = `uploads/${params.filename}`;
    const requestUrl = `${this.requestBaseUrl()}/${key}`;
    const publicUrl = `${this.publicBaseUrl()}/${key}`;
    const res = await this.signedRequest('PUT', requestUrl, params.buffer, params.mime);
    if (!res.ok) throw new Error(`S3 PUT failed with HTTP ${res.status}`);
    return { url: publicUrl, key, mime: params.mime, bytes: params.buffer.length };
  }

  async remove(key: string): Promise<void> {
    this.requireConfig();
    if (!SAFE_OBJECT_KEY.test(key) || key.includes('..')) throw new Error('Unsafe S3 object key');
    const res = await this.signedRequest('DELETE', `${this.requestBaseUrl()}/${key}`);
    if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE failed with HTTP ${res.status}`);
  }

  keyFromTarget(target: string): string | null {
    let value = target;
    if (/^https?:\/\//i.test(target)) {
      try {
        value = new URL(target).pathname;
      } catch {
        return null;
      }
    }
    const uploadAt = value.indexOf('/uploads/');
    const key = uploadAt >= 0 ? value.slice(uploadAt + 1) : value;
    return MANAGED_OBJECT_KEY.test(key) ? key : null;
  }

  private async signedRequest(
    method: 'PUT' | 'DELETE',
    url: string,
    body?: Buffer,
    mime?: string
  ): Promise<Response> {
    const region = process.env.S3_REGION as string;
    const service = 's3';
    const parsedUrl = new URL(url);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = crypto
      .createHash('sha256')
      .update(body ?? '')
      .digest('hex');

    const headers: Record<string, string> = {
      host: parsedUrl.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (mime) headers['content-type'] = mime;

    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join('');
    const canonicalRequest = [
      method,
      parsedUrl.pathname,
      '',
      canonicalHeaders,
      signedHeaderNames.join(';'),
      payloadHash,
    ].join('\n');

    const scope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const kDate = crypto
      .createHmac('sha256', `AWS4${process.env.S3_SECRET_ACCESS_KEY}`)
      .update(dateStamp)
      .digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    headers.Authorization =
      `AWS4-HMAC-SHA256 Credential=${process.env.S3_ACCESS_KEY_ID}/${scope}, ` +
      `SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`;

    return fetch(parsedUrl, {
      method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }
}
