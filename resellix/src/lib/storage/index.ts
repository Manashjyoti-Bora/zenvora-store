import { logger } from '../logger';
import { CloudinaryStorageProvider } from './cloudinary';
import { LocalStorageProvider } from './local';
import { S3StorageProvider } from './s3';
import type { StorageProvider } from './types';

export * from './types';

/**
 * Provider selection (STORAGE_PROVIDER env): local (default) | s3 | cloudinary.
 * Falls back to local with a loud log when the chosen provider is
 * misconfigured - uploads then behave as before instead of silently failing.
 */
let cached: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cached) return cached;
  const choice = (process.env.STORAGE_PROVIDER ?? 'local').toLowerCase();
  if (choice === 's3') {
    const p = new S3StorageProvider();
    if (p.isConfigured()) return (cached = p);
    logger.error('STORAGE_PROVIDER=s3 but credentials missing - falling back to local disk');
  } else if (choice === 'cloudinary') {
    const p = new CloudinaryStorageProvider();
    if (p.isConfigured()) return (cached = p);
    logger.error('STORAGE_PROVIDER=cloudinary but credentials missing - falling back to local disk');
  }
  return (cached = new LocalStorageProvider());
}

/** Test hook: reset memoised provider after env stubbing. */
export function resetStorageProviderCache(): void {
  cached = null;
}
