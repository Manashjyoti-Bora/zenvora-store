import fs from 'node:fs/promises';
import path from 'node:path';
import type { StorageObject, StorageProvider } from './types';

/**
 * Local-disk provider (development / single-server). NOT persistent on
 * serverless hosts - the upload UI and docs say so explicitly.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local' as const;
  readonly persistent = false;

  isConfigured(): boolean {
    return true;
  }

  async put(params: { buffer: Buffer; filename: string; mime: string }): Promise<StorageObject> {
    const dir = path.join(process.cwd(), 'public', 'uploads');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, params.filename), params.buffer);
    return {
      url: `/uploads/${params.filename}`,
      key: params.filename,
      mime: params.mime,
      bytes: params.buffer.length,
    };
  }

  async remove(key: string): Promise<void> {
    const safe = path.basename(key);
    await fs.unlink(path.join(process.cwd(), 'public', 'uploads', safe)).catch(() => undefined);
  }
}
