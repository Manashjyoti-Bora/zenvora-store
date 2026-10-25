import { describe, expect, it } from 'vitest';
import { isSafeMediaUrl } from '@/lib/images/url-safety';
import { isValidProductImageUrl } from '@/lib/catalog/ranking';
import { productImageSchema, productInputSchema } from '@/lib/validation/schemas';

/**
 * Product media URLs reach customer browsers and the image optimizer. Only
 * https:// on a public named host, or site-relative /uploads/ paths, are
 * acceptable. Each rejected case below was previously accepted somewhere in
 * the pipeline (admin form, CSV import or supplier import).
 */
describe('isSafeMediaUrl', () => {
  it('accepts https on public hosts and /uploads/ paths', () => {
    for (const u of [
      'https://cf.cjdropshipping.com/a/b.jpg',
      'https://res.cloudinary.com/demo/image/upload/v1/x.webp',
      'https://bucket.s3.ap-south-1.amazonaws.com/k.png?X-Amz-Signature=abc',
      '/uploads/2026/10/photo.jpg',
      '/uploads/seed/demo-item.svg',
    ]) {
      expect(isSafeMediaUrl(u), u).toBe(true);
    }
  });

  it('rejects non-https schemes (mixed content / script URLs)', () => {
    for (const u of [
      'http://cf.cjdropshipping.com/a.jpg',
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:image/png;base64,iVBORw0KGgo=',
      'vbscript:msgbox',
      'ftp://files.example.net/a.jpg',
      'file:///etc/passwd',
    ]) {
      expect(isSafeMediaUrl(u), u).toBe(false);
    }
  });

  it('rejects private, loopback, link-local and single-label hosts', () => {
    for (const u of [
      'https://127.0.0.1/a.jpg',
      'https://10.0.0.5/a.jpg',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/a.jpg',
      'https://localhost/a.jpg',
      'https://intranet/a.jpg',
      'https://nas.local/a.jpg',
      'https://db.internal/a.jpg',
      'https://metadata.google.internal/x',
    ]) {
      expect(isSafeMediaUrl(u), u).toBe(false);
    }
  });

  it('rejects credentials, protocol-relative URLs, traversal and control characters', () => {
    for (const u of [
      'https://user:pass@cdn.example.com/a.jpg',
      '//cdn.example.com/a.jpg',
      '/uploads/../.env',
      '/uploads/./x.jpg',
      '/etc/passwd',
      'https://cdn.example.com/a\n.jpg',
      'https://cdn.example.com/a b.jpg',
      '',
      '   ',
      'https://cdn.example.com/' + 'a'.repeat(2100),
    ]) {
      expect(isSafeMediaUrl(u), JSON.stringify(u)).toBe(false);
    }
  });

  it('is what the supplier importer uses', () => {
    expect(isValidProductImageUrl('http://cf.cjdropshipping.com/a.jpg')).toBe(false);
    expect(isValidProductImageUrl('https://cf.cjdropshipping.com/a.jpg')).toBe(true);
  });
});

describe('admin product image schema', () => {
  it('rejects unsafe image and video URLs with a human message', () => {
    const bad = productImageSchema.safeParse({ url: 'javascript:alert(1)' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toMatch(/https:\/\//);

    const badVideo = productImageSchema.safeParse({
      url: 'https://cdn.example.com/a.jpg',
      videoUrl: 'http://cdn.example.com/a.mp4',
    });
    expect(badVideo.success).toBe(false);

    const ok = productImageSchema.safeParse({
      url: 'https://cdn.example.com/a.jpg',
      videoUrl: '',
    });
    expect(ok.success).toBe(true);
  });

  it('blocks the whole product payload when any image URL is unsafe', () => {
    const base = {
      name: 'Safe product',
      slug: 'safe-product',
      description: 'A perfectly ordinary description that is long enough.',
      costPrice: 100,
      pricingMode: 'FIXED_PRICE',
      fixedPrice: 199,
      stock: 5,
      status: 'DRAFT',
      images: [{ url: 'https://10.0.0.5/private.jpg', isPrimary: true, position: 0 }],
      variants: [],
    };
    const res = productInputSchema.safeParse(base);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.join('.') === 'images.0.url')).toBe(true);
    }
  });
});
