import { isOptimizableImageSrc, resolveImageRemoteHosts } from './remote-hosts.mjs';

/**
 * Runtime view of the image-host allow-list.
 *
 * `NEXT_PUBLIC_IMAGE_REMOTE_HOSTS` is written by next.config.mjs from the same
 * resolver, so server components, client components and the optimizer config
 * all agree. When the variable is absent (unit tests, scripts) we resolve the
 * list from the process environment directly.
 */
export function imageRemoteHosts(): readonly string[] {
  const inlined = process.env.NEXT_PUBLIC_IMAGE_REMOTE_HOSTS;
  if (inlined !== undefined) {
    return inlined
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
  }
  return resolveImageRemoteHosts(process.env);
}

/** True when `src` may be routed through `/_next/image`. */
export function canOptimizeImage(src: string): boolean {
  return isOptimizableImageSrc(src, imageRemoteHosts());
}

export { hostMatchesPattern, isOptimizableImageSrc, resolveImageRemoteHosts } from './remote-hosts.mjs';
