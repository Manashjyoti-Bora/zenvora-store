import { describe, expect, it } from 'vitest';
import {
  hostMatchesPattern,
  isOptimizableImageSrc,
  resolveImageRemoteHosts,
} from '@/lib/images/remote-hosts';
import { DEFAULT_IMAGE_REMOTE_HOSTS } from '@/lib/images/remote-hosts.mjs';

/**
 * Image optimizer allow-list (replaces the former `hostname: '**'`). These
 * tests pin the contract next.config.mjs and <RemoteImage> both rely on.
 */
describe('resolveImageRemoteHosts', () => {
  it('uses the built-in supplier/storage hosts when nothing is configured', () => {
    expect(resolveImageRemoteHosts({})).toEqual([...DEFAULT_IMAGE_REMOTE_HOSTS]);
    expect(resolveImageRemoteHosts({})).not.toContain('**');
  });

  it('IMAGE_REMOTE_HOSTS replaces the defaults (operators can tighten the list)', () => {
    expect(resolveImageRemoteHosts({ IMAGE_REMOTE_HOSTS: 'cdn.zenvora.in, **.r2.dev' })).toEqual([
      'cdn.zenvora.in',
      '**.r2.dev',
    ]);
  });

  it('appends configured storage hosts and drops garbage entries', () => {
    const hosts = resolveImageRemoteHosts({
      IMAGE_REMOTE_HOSTS: 'cdn.zenvora.in, not a host!, https://bad',
      S3_PUBLIC_BASE_URL: 'https://media.example.org/assets',
      S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      S3_BUCKET: 'zenvora-media',
    });
    expect(hosts).toEqual([
      'cdn.zenvora.in',
      'media.example.org',
      'acct.r2.cloudflarestorage.com',
      'zenvora-media.acct.r2.cloudflarestorage.com',
    ]);
  });
});

describe('hostMatchesPattern', () => {
  it('matches exact hosts only for plain patterns', () => {
    expect(hostMatchesPattern('res.cloudinary.com', 'res.cloudinary.com')).toBe(true);
    expect(hostMatchesPattern('evil.res.cloudinary.com', 'res.cloudinary.com')).toBe(false);
    expect(hostMatchesPattern('res.cloudinary.com.evil.net', 'res.cloudinary.com')).toBe(false);
  });

  it('`*.` matches exactly one label, `**.` any depth', () => {
    expect(hostMatchesPattern('a.example.com', '*.example.com')).toBe(true);
    expect(hostMatchesPattern('b.a.example.com', '*.example.com')).toBe(false);
    expect(hostMatchesPattern('b.a.example.com', '**.example.com')).toBe(true);
    expect(hostMatchesPattern('example.com.evil.net', '**.example.com')).toBe(false);
    expect(hostMatchesPattern('notexample.com', '**.example.com')).toBe(false);
  });
});

describe('isOptimizableImageSrc', () => {
  const hosts = ['**.cjdropshipping.com', 'res.cloudinary.com'];

  it('always allows local uploads and rejects protocol-relative / non-https URLs', () => {
    expect(isOptimizableImageSrc('/uploads/seed/a.jpg', hosts)).toBe(true);
    expect(isOptimizableImageSrc('//cf.cjdropshipping.com/a.jpg', hosts)).toBe(false);
    expect(isOptimizableImageSrc('http://cf.cjdropshipping.com/a.jpg', hosts)).toBe(false);
    expect(isOptimizableImageSrc('data:image/png;base64,AAAA', hosts)).toBe(false);
    expect(isOptimizableImageSrc('', hosts)).toBe(false);
  });

  it('allows listed https hosts and refuses everything else', () => {
    expect(isOptimizableImageSrc('https://cf.cjdropshipping.com/p/1.jpg', hosts)).toBe(true);
    expect(isOptimizableImageSrc('https://res.cloudinary.com/zen/image/upload/x.webp', hosts)).toBe(true);
    expect(isOptimizableImageSrc('https://images.unsplash.com/photo', hosts)).toBe(false);
    expect(isOptimizableImageSrc('https://res.cloudinary.com.evil.net/x', hosts)).toBe(false);
  });
});
