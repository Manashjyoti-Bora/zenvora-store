import Image, { type ImageProps } from 'next/image';
import { canOptimizeImage } from '@/lib/images/remote-hosts.mjs';

/**
 * Drop-in replacement for `next/image` for catalogue media.
 *
 * The optimizer only accepts hosts listed in `images.remotePatterns`
 * (`IMAGE_REMOTE_HOSTS`, see src/lib/images/remote-hosts.mjs). A product
 * imported from a supplier can still reference some other CDN; instead of
 * letting `next/image` throw at render time (which would 500 the page) such
 * URLs are rendered `unoptimized` — a plain `<img>` loaded straight from the
 * origin. Local uploads and allow-listed hosts keep full optimization.
 *
 * Works in both server and client components (no hooks, no state).
 */
export default function RemoteImage(props: ImageProps) {
  const { src, unoptimized, ...rest } = props;
  const optimizable = typeof src === 'string' ? canOptimizeImage(src) : true;
  return <Image src={src} unoptimized={unoptimized ?? !optimizable} {...rest} />;
}
