import { CloudinaryStorageProvider } from './cloudinary';
import { LocalStorageProvider } from './local';
import { S3StorageProvider } from './s3';
import { StorageNotConfiguredError, type StorageProvider } from './types';

export * from './types';

/**
 * Select storage without ever hiding a misconfiguration behind local disk.
 * Local storage is intentionally limited to development/test; serverless
 * Production must explicitly configure a durable provider.
 */
let cached: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cached) return cached;
  const choice = (process.env.STORAGE_PROVIDER ?? '').trim().toLowerCase() || 'local';

  if (choice === 'local') {
    if (process.env.NODE_ENV === 'production') {
      throw new StorageNotConfiguredError(
        'Durable storage is required in Production. Configure STORAGE_PROVIDER=s3 or cloudinary; local disk is ephemeral and uploads are disabled.'
      );
    }
    return (cached = new LocalStorageProvider());
  }
  if (choice === 's3') {
    const provider = new S3StorageProvider();
    if (!provider.isConfigured()) {
      throw new StorageNotConfiguredError(
        provider.configurationIssue() ?? 'S3 storage is not configured'
      );
    }
    return (cached = provider);
  }
  if (choice === 'cloudinary') {
    const provider = new CloudinaryStorageProvider();
    if (!provider.isConfigured()) {
      throw new StorageNotConfiguredError(
        provider.configurationIssue() ?? 'Cloudinary storage is not configured'
      );
    }
    return (cached = provider);
  }
  throw new StorageNotConfiguredError(
    `Unsupported STORAGE_PROVIDER. Use local (development/test only), s3, or cloudinary.`
  );
}

/** Test hook: reset memoised provider after env stubbing. */
export function resetStorageProviderCache(): void {
  cached = null;
}
