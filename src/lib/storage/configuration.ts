import { isSafeMediaUrl } from '@/lib/images/url-safety';

export interface S3ConfigurationEnv {
  NODE_ENV?: string;
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_ENDPOINT?: string;
  S3_PUBLIC_BASE_URL?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
}

export interface CloudinaryConfigurationEnv {
  CLOUDINARY_CLOUD_NAME?: string;
  CLOUDINARY_API_KEY?: string;
  CLOUDINARY_API_SECRET?: string;
  CLOUDINARY_FOLDER?: string;
}

const SAFE_FOLDER = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

export function cloudinaryFolder(env: CloudinaryConfigurationEnv | NodeJS.ProcessEnv): string {
  return env.CLOUDINARY_FOLDER || 'zenvora';
}

export function cloudinaryConfigurationIssue(
  env: CloudinaryConfigurationEnv | NodeJS.ProcessEnv
): string | null {
  const missing = [
    !env.CLOUDINARY_CLOUD_NAME && 'CLOUDINARY_CLOUD_NAME',
    !env.CLOUDINARY_API_KEY && 'CLOUDINARY_API_KEY',
    !env.CLOUDINARY_API_SECRET && 'CLOUDINARY_API_SECRET',
  ].filter((x): x is string => Boolean(x));
  if (missing.length) return `Cloudinary storage is missing ${missing.join(', ')}`;
  if (!/^[A-Za-z0-9_-]+$/.test(env.CLOUDINARY_CLOUD_NAME as string)) {
    return 'CLOUDINARY_CLOUD_NAME is invalid';
  }
  if (!SAFE_FOLDER.test(cloudinaryFolder(env))) {
    return 'CLOUDINARY_FOLDER may contain only letters, numbers, underscores, hyphens, and slashes';
  }
  return null;
}

export function s3PublicBaseUrl(env: S3ConfigurationEnv): string {
  if (env.S3_PUBLIC_BASE_URL) return env.S3_PUBLIC_BASE_URL.replace(/\/+$/, '');
  return `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com`;
}

export function s3ConfigurationIssue(env: S3ConfigurationEnv): string | null {
  const missing = [
    !env.S3_BUCKET && 'S3_BUCKET',
    !env.S3_REGION && 'S3_REGION',
    !env.S3_ACCESS_KEY_ID && 'S3_ACCESS_KEY_ID',
    !env.S3_SECRET_ACCESS_KEY && 'S3_SECRET_ACCESS_KEY',
  ].filter((x): x is string => Boolean(x));
  if (missing.length) return `S3 storage is missing ${missing.join(', ')}`;

  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.S3_BUCKET as string) ||
    (env.S3_BUCKET as string).includes('..')
  ) {
    return 'S3_BUCKET is not a valid bucket name';
  }
  if (!/^[a-z0-9-]+$/.test(env.S3_REGION as string)) return 'S3_REGION is invalid';

  try {
    if (env.S3_ENDPOINT) {
      const endpoint = new URL(env.S3_ENDPOINT);
      if (
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash ||
        (endpoint.pathname !== '/' && endpoint.pathname !== '')
      ) {
        return 'S3_ENDPOINT must be an origin only, without credentials, path, query, or fragment';
      }
      if (endpoint.protocol !== 'https:' && env.NODE_ENV === 'production') {
        return 'S3_ENDPOINT must use HTTPS in Production';
      }
      if (!['http:', 'https:'].includes(endpoint.protocol)) {
        return 'S3_ENDPOINT must use HTTP(S)';
      }
      if (env.NODE_ENV === 'production' && !isSafeMediaUrl(endpoint.origin)) {
        return 'S3_ENDPOINT must be a public named host in Production';
      }
      if (!env.S3_PUBLIC_BASE_URL) {
        return 'S3_PUBLIC_BASE_URL is required with a custom S3_ENDPOINT (R2/MinIO)';
      }
    }
    const publicBase = s3PublicBaseUrl(env);
    const probe = `${publicBase}/uploads/p-1-ABCDEFGH.png`;
    if (!isSafeMediaUrl(probe)) {
      return 'S3_PUBLIC_BASE_URL must be a public HTTPS URL without credentials, query, or fragment';
    }
    const parsedPublic = new URL(publicBase);
    if (
      parsedPublic.search ||
      parsedPublic.hash ||
      parsedPublic.pathname.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      return 'S3_PUBLIC_BASE_URL contains an unsafe path, query, or fragment';
    }
  } catch {
    return 'S3 endpoint/public URL is invalid';
  }
  return null;
}
