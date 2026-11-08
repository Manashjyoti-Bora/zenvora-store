import crypto from 'node:crypto';
import { isSafeMediaUrl } from '@/lib/images/url-safety';
import { cloudinaryConfigurationIssue, cloudinaryFolder } from './configuration';
import { StorageNotConfiguredError, type StorageObject, type StorageProvider } from './types';

const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;
const REQUEST_TIMEOUT_MS = 20_000;

/** Cloudinary signed REST uploads; API secrets remain server-only. */
export class CloudinaryStorageProvider implements StorageProvider {
  readonly name = 'cloudinary' as const;
  readonly persistent = true;

  isConfigured(): boolean {
    return this.configurationIssue() === null;
  }

  configurationIssue(): string | null {
    return cloudinaryConfigurationIssue(process.env);
  }

  private requireConfig(): void {
    const issue = this.configurationIssue();
    if (issue) throw new StorageNotConfiguredError(issue);
  }

  private folder(): string {
    return cloudinaryFolder(process.env);
  }

  async put(params: { buffer: Buffer; filename: string; mime: string }): Promise<StorageObject> {
    this.requireConfig();
    if (!SAFE_FILENAME.test(params.filename) || params.filename.includes('..')) {
      throw new Error('Unsafe storage filename');
    }
    const folder = this.folder();
    const publicId = `${folder}/${params.filename.replace(/\.[a-z0-9]+$/i, '')}`;
    const fields: Record<string, string> = {
      public_id: publicId,
      timestamp: String(Math.floor(Date.now() / 1000)),
      asset_folder: folder,
      // Store the original for the existing responsive Next.js optimizer;
      // Cloudinary can still negotiate efficient formats at delivery time.
      unique_filename: 'false',
      overwrite: 'false',
    };
    fields.signature = this.sign(fields);
    fields.api_key = process.env.CLOUDINARY_API_KEY as string;

    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append(
      'file',
      new Blob([new Uint8Array(params.buffer)], { type: params.mime }),
      params.filename
    );

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
      { method: 'POST', body: form, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!res.ok) throw new Error(`Cloudinary upload failed with HTTP ${res.status}`);
    const json = (await res.json()) as { secure_url?: unknown; public_id?: unknown };
    if (typeof json.secure_url !== 'string' || !isSafeMediaUrl(json.secure_url)) {
      throw new Error('Cloudinary upload returned an unsafe or missing secure_url');
    }
    if (json.public_id !== publicId) {
      throw new Error('Cloudinary upload returned an unexpected public_id');
    }
    return { url: json.secure_url, key: publicId, mime: params.mime, bytes: params.buffer.length };
  }

  async remove(key: string): Promise<void> {
    this.requireConfig();
    if (!key.startsWith(`${this.folder()}/`) || key.includes('..') || key.includes('\\')) {
      throw new Error('Unsafe Cloudinary public_id');
    }
    const fields: Record<string, string> = {
      public_id: key,
      timestamp: String(Math.floor(Date.now() / 1000)),
    };
    fields.signature = this.sign(fields);
    fields.api_key = process.env.CLOUDINARY_API_KEY as string;
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/destroy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );
    if (!res.ok) throw new Error(`Cloudinary destroy failed with HTTP ${res.status}`);
    const result = (await res.json().catch(() => null)) as { result?: unknown } | null;
    if (result?.result !== 'ok' && result?.result !== 'not found') {
      throw new Error('Cloudinary destroy did not confirm deletion');
    }
  }

  keyFromTarget(target: string): string | null {
    // Cloudinary delivery URLs may contain transformations/version segments;
    // require the exact public_id returned by upload instead of guessing.
    if (/^https?:\/\//i.test(target) || target.startsWith('/')) return null;
    const match = new RegExp(
      `^${this.folder().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/(p-\\d+-[A-Za-z0-9_-]+)$`
    ).exec(target);
    return match ? `${this.folder()}/${match[1]}` : null;
  }

  /** Cloudinary signature: sha1 of sorted `k=v` pairs joined with & + api secret. */
  private sign(fields: Record<string, string>): string {
    const payload = Object.keys(fields)
      .filter((k) => k !== 'signature' && k !== 'api_key')
      .sort()
      .map((k) => `${k}=${fields[k]}`)
      .join('&');
    return crypto
      .createHash('sha1')
      .update(payload + process.env.CLOUDINARY_API_SECRET)
      .digest('hex');
  }
}
