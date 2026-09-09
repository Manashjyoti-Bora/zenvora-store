import crypto from 'node:crypto';
import { StorageNotConfiguredError, type StorageObject, StorageProvider } from './types';

/**
 * Cloudinary provider (REST, signed uploads - no SDK).
 * Env: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
 * optional CLOUDINARY_FOLDER.
 */
export class CloudinaryStorageProvider implements StorageProvider {
  readonly name = 'cloudinary' as const;
  readonly persistent = true;

  isConfigured(): boolean {
    return Boolean(
      process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET
    );
  }

  private requireConfig() {
    if (!this.isConfigured()) {
      throw new StorageNotConfiguredError(
        'Cloudinary selected but CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET are missing'
      );
    }
  }

  async put(params: { buffer: Buffer; filename: string; mime: string }): Promise<StorageObject> {
    this.requireConfig();
    const folder = process.env.CLOUDINARY_FOLDER ?? 'zenvora';
    const publicId = `${folder}/${params.filename.replace(/\.[a-z0-9]+$/i, '')}`;
    const fields: Record<string, string> = {
      public_id: publicId,
      timestamp: String(Math.floor(Date.now() / 1000)),
      asset_folder: folder,
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
      { method: 'POST', body: form }
    );
    if (!res.ok) {
      throw new Error(`Cloudinary upload failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
    }
    const json = (await res.json()) as { secure_url?: string; public_id?: string };
    if (!json.secure_url) throw new Error('Cloudinary upload returned no secure_url');
    return {
      url: json.secure_url,
      key: json.public_id ?? publicId,
      mime: params.mime,
      bytes: params.buffer.length,
    };
  }

  async remove(key: string): Promise<void> {
    this.requireConfig();
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
      }
    );
    if (!res.ok) throw new Error(`Cloudinary destroy failed: HTTP ${res.status}`);
  }

  /** Cloudinary signature: sha1 of sorted `k=v` pairs joined with & + api secret. */
  private sign(fields: Record<string, string>): string {
    const payload = Object.keys(fields)
      .filter((k) => k !== 'signature' && k !== 'api_key')
      .sort()
      .map((k) => `${k}=${fields[k]}`)
      .join('&');
    return crypto.createHash('sha1').update(payload + process.env.CLOUDINARY_API_SECRET).digest('hex');
  }
}
