import fs from 'node:fs/promises';
import path from 'node:path';
import type { StorageObject, StorageProvider } from './types';

const MANAGED_LOCAL_KEY = /^p-\d+-[A-Za-z0-9_-]+\.(?:jpg|png|webp|gif|avif)$/;

/** Local-disk provider for development/test only (ephemeral on serverless). */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local' as const;
  readonly persistent = false;

  isConfigured(): boolean {
    return process.env.NODE_ENV !== 'production';
  }

  async put(params: { buffer: Buffer; filename: string; mime: string }): Promise<StorageObject> {
    if (!this.isConfigured()) {
      throw new Error('Local storage is disabled in Production');
    }
    assertSafeFilename(params.filename);
    const dir = path.join(process.cwd(), 'public', 'uploads');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, params.filename), params.buffer, { flag: 'wx' });
    return {
      url: `/uploads/${params.filename}`,
      key: params.filename,
      mime: params.mime,
      bytes: params.buffer.length,
    };
  }

  async remove(key: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Local storage is disabled in Production');
    }
    assertSafeFilename(key);
    await fs.unlink(path.join(process.cwd(), 'public', 'uploads', key)).catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    });
  }

  keyFromTarget(target: string): string | null {
    let pathname = target;
    if (/^https?:\/\//i.test(target)) {
      try {
        pathname = new URL(target).pathname;
      } catch {
        return null;
      }
    }
    const key = pathname.startsWith('/uploads/')
      ? pathname.slice('/uploads/'.length)
      : pathname.startsWith('uploads/')
        ? pathname.slice('uploads/'.length)
        : pathname;
    return MANAGED_LOCAL_KEY.test(key) ? key : null;
  }
}

function assertSafeFilename(filename: string): void {
  if (
    !filename ||
    filename.length > 180 ||
    filename !== path.basename(filename) ||
    filename.includes('\\') ||
    filename.includes('..')
  ) {
    throw new Error('Unsafe storage filename');
  }
  for (let i = 0; i < filename.length; i++) {
    const code = filename.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) throw new Error('Unsafe storage filename');
  }
}
