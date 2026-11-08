/**
 * ============================================================================
 * STORAGE PROVIDER ABSTRACTION
 * ============================================================================
 * Product images must not depend on the ephemeral Vercel filesystem. The
 * upload pipeline talks only to this interface; the concrete provider is
 * selected by STORAGE_PROVIDER (local | s3 | cloudinary).
 *
 *  - local       development/test only; files under public/uploads.
 *  - s3          any S3-compatible object store (R2, MinIO, AWS S3) via SigV4;
 *                credentials only from environment variables.
 *  - cloudinary  Cloudinary REST signed uploads.
 *
 * Secrets never reach the client; deletes go through the same provider and
 * are restricted to unattached, app-managed uploads.
 */

export interface StorageObject {
  /** Publicly serveable URL (relative for local, absolute for remote). */
  url: string;
  /** Provider-side key/path used for delete/replace. */
  key: string;
  mime: string;
  bytes: number;
}

export interface StorageProvider {
  readonly name: 'local' | 's3' | 'cloudinary';
  /** True when the provider keeps objects across deploys/restarts. */
  readonly persistent: boolean;
  isConfigured(): boolean;
  put(params: { buffer: Buffer; filename: string; mime: string }): Promise<StorageObject>;
  remove(key: string): Promise<void>;
  /**
   * Resolve an admin supplied key/URL to an app-managed `p-<date>-<random>`
   * upload key. Null means deletion must be refused. This does not authorize
   * deleting supplier/seed media or arbitrary objects in the same account.
   */
  keyFromTarget(target: string): string | null;
}

export class StorageNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageNotConfiguredError';
  }
}
