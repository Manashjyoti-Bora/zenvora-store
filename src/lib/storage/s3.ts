import crypto from 'node:crypto';
import { StorageNotConfiguredError, type StorageObject, StorageProvider } from './types';

/**
 * S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, …) using
 * SigV4-signed PUT/DELETE - no SDK dependency. Credentials come exclusively
 * from environment variables (see .process.env.example):
 *   S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 *   S3_ENDPOINT (optional, for R2/MinIO), S3_PUBLIC_BASE_URL (optional CDN).
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3' as const;
  readonly persistent = true;

  isConfigured(): boolean {
    return Boolean(
      process.env.S3_BUCKET && process.env.S3_REGION && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    );
  }

  private requireConfig() {
    if (!this.isConfigured()) {
      throw new StorageNotConfiguredError(
        'S3 storage selected but S3_BUCKET/S3_REGION/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY are missing'
      );
    }
  }

  private endpointHost(): { host: string; urlBase: string } {
    const bucket = process.env.S3_BUCKET as string;
    const region = process.env.S3_REGION as string;
    if (process.env.S3_ENDPOINT) {
      const u = new URL(process.env.S3_ENDPOINT);
      return {
        host: u.host,
        urlBase: process.env.S3_PUBLIC_BASE_URL ?? `${u.protocol}//${bucket}.${u.host}`,
      };
    }
    return {
      host: `${bucket}.s3.${region}.amazonaws.com`,
      urlBase: process.env.S3_PUBLIC_BASE_URL ?? `https://${bucket}.s3.${region}.amazonaws.com`,
    };
  }

  async put(params: { buffer: Buffer; filename: string; mime: string }): Promise<StorageObject> {
    this.requireConfig();
    const key = `uploads/${params.filename}`;
    const { host, urlBase } = this.endpointHost();
    const url = `https://${host}/${key}`;
    const res = await this.signedRequest('PUT', url, key, params.buffer, params.mime);
    if (!res.ok) {
      throw new Error(`S3 PUT failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
    }
    return {
      url: `${urlBase.replace(/\/$/, '')}/${key}`,
      key,
      mime: params.mime,
      bytes: params.buffer.length,
    };
  }

  async remove(key: string): Promise<void> {
    this.requireConfig();
    const { host } = this.endpointHost();
    const res = await this.signedRequest(
      'DELETE',
      `https://${host}/${key}`,
      key,
      undefined,
      undefined
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`S3 DELETE failed: HTTP ${res.status}`);
    }
  }

  private async signedRequest(
    method: 'PUT' | 'DELETE',
    url: string,
    key: string,
    body: Buffer | undefined,
    mime: string | undefined
  ): Promise<Response> {
    const region = process.env.S3_REGION as string;
    const service = 's3';
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = crypto.createHash('sha256').update(body ?? '').digest('hex');

    const headers: Record<string, string> = {
      host: new URL(url).host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (mime) headers['content-type'] = mime;

    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join('');
    const canonicalRequest = [
      method,
      `/${key}`,
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

    const kDate = crypto.createHmac('sha256', `AWS4${process.env.S3_SECRET_ACCESS_KEY}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    headers.Authorization =
      `AWS4-HMAC-SHA256 Credential=${process.env.S3_ACCESS_KEY_ID}/${scope}, ` +
      `SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`;

    return fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined });
  }
}
