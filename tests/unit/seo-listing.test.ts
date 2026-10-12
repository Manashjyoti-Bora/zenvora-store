import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  carryListingQuery,
  isFilteredListing,
  itemListJsonLd,
  listingDescription,
  listingSeo,
  listingTitle,
  parseListingPage,
} from '@/lib/seo/listing';

describe('parseListingPage', () => {
  it('defaults to 1 for missing/empty/garbage input', () => {
    expect(parseListingPage(undefined)).toBe(1);
    expect(parseListingPage('')).toBe(1);
    expect(parseListingPage('abc')).toBe(1);
    expect(parseListingPage('0')).toBe(1);
    expect(parseListingPage('-3')).toBe(1);
  });

  it('parses positive integers and floors decimals', () => {
    expect(parseListingPage('1')).toBe(1);
    expect(parseListingPage('4')).toBe(4);
    expect(parseListingPage('2.9')).toBe(2);
  });
});

describe('isFilteredListing', () => {
  it('treats clean listings (including pagination) as unfiltered', () => {
    expect(isFilteredListing({})).toBe(false);
    expect(isFilteredListing({ page: '3' })).toBe(false);
    expect(isFilteredListing({ sort: 'featured' })).toBe(false);
    expect(isFilteredListing({ sort: '' })).toBe(false);
  });

  it('flags every filter dimension', () => {
    expect(isFilteredListing({ q: 'shoes' })).toBe(true);
    expect(isFilteredListing({ category: 'shoes' })).toBe(true);
    expect(isFilteredListing({ min: '250' })).toBe(true);
    expect(isFilteredListing({ max: '500' })).toBe(true);
    expect(isFilteredListing({ stock: '1' })).toBe(true);
    expect(isFilteredListing({ sort: 'price-asc' })).toBe(true);
    expect(isFilteredListing({ sort: 'bogus-value' })).toBe(true);
  });

  it('ignores blank/whitespace-only selectors', () => {
    expect(isFilteredListing({ q: '   ' })).toBe(false);
    expect(isFilteredListing({ category: '' })).toBe(false);
  });
});

describe('listingSeo', () => {
  it('keeps clean page 1 indexable with a self canonical', () => {
    expect(listingSeo('/shop', {})).toEqual({
      canonical: '/shop',
      robots: undefined,
      page: 1,
      filtered: false,
    });
  });

  it('keeps clean paginated pages indexable with a ?page=N self canonical', () => {
    expect(listingSeo('/shop', { page: '3' })).toEqual({
      canonical: '/shop?page=3',
      robots: undefined,
      page: 3,
      filtered: false,
    });
  });

  it('noindexes filtered views and canonicalizes to the clean listing URL', () => {
    const seo = listingSeo('/shop', { sort: 'price-asc', min: '250', page: '2' });
    expect(seo).toEqual({
      canonical: '/shop',
      robots: { index: false, follow: true },
      page: 2,
      filtered: true,
    });
  });

  it('noindexes filtered category views and canonicalizes to the category URL', () => {
    const seo = listingSeo('/categories/shoes', { q: 'red', stock: '1' });
    expect(seo.canonical).toBe('/categories/shoes');
    expect(seo.robots).toEqual({ index: false, follow: true });
    expect(seo.filtered).toBe(true);
  });

  it('consolidates legacy /shop?category= URLs onto the canonical category page', () => {
    const seo = listingSeo('/shop', { category: 'shoes' });
    expect(seo.canonical).toBe('/categories/shoes');
    expect(seo.robots).toEqual({ index: false, follow: true });
  });
});

describe('listingTitle / listingDescription', () => {
  it('keeps page-1 metadata untouched', () => {
    expect(listingTitle('Shop all products', 1)).toBe('Shop all products');
    expect(listingDescription('Browse the catalog.', 1)).toBe('Browse the catalog.');
  });

  it('gives paginated pages distinct metadata', () => {
    expect(listingTitle('Shop all products', 2)).toBe('Shop all products – Page 2');
    expect(listingDescription('Browse the catalog.', 2)).toBe('Browse the catalog. (Page 2.)');
  });
});

describe('carryListingQuery', () => {
  it('returns an empty string when there is nothing to carry', () => {
    expect(carryListingQuery({})).toBe('');
    expect(carryListingQuery({ page: '3', category: 'shoes' })).toBe('');
  });

  it('carries filter context but drops pagination and the category selector', () => {
    const carried = carryListingQuery({
      q: 'red shoes',
      sort: 'price-asc',
      min: '250',
      max: '',
      stock: '1',
      page: '3',
      category: 'shoes',
    });
    expect(carried.startsWith('?')).toBe(true);
    const params = new URLSearchParams(carried.slice(1));
    expect(params.get('q')).toBe('red shoes');
    expect(params.get('sort')).toBe('price-asc');
    expect(params.get('min')).toBe('250');
    expect(params.get('stock')).toBe('1');
    expect(params.has('max')).toBe(false);
    expect(params.has('page')).toBe(false);
    expect(params.has('category')).toBe(false);
  });
});

describe('absoluteUrl', () => {
  it('leaves absolute http(s) URLs untouched', () => {
    expect(absoluteUrl('https://shop.test', 'https://cdn.test/a.jpg')).toBe(
      'https://cdn.test/a.jpg'
    );
    expect(absoluteUrl('https://shop.test', 'http://cdn.test/a.jpg')).toBe('http://cdn.test/a.jpg');
  });

  it('resolves root-relative and bare paths against the base', () => {
    expect(absoluteUrl('https://shop.test', '/uploads/a.jpg')).toBe(
      'https://shop.test/uploads/a.jpg'
    );
    expect(absoluteUrl('https://shop.test/', 'uploads/a.jpg')).toBe(
      'https://shop.test/uploads/a.jpg'
    );
  });
});

describe('breadcrumbJsonLd', () => {
  it('builds positions and omits item for the current page', () => {
    const ld = breadcrumbJsonLd('https://shop.test', [
      { label: 'Home', href: '/' },
      { label: 'Shop', href: '/shop' },
      { label: 'Shoes' },
    ]) as {
      '@type': string;
      itemListElement: Array<{ position: number; name: string; item?: string }>;
    };
    expect(ld['@type']).toBe('BreadcrumbList');
    expect(ld.itemListElement).toHaveLength(3);
    expect(ld.itemListElement[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: 'https://shop.test/',
    });
    expect(ld.itemListElement[2]).toEqual({
      '@type': 'ListItem',
      position: 3,
      name: 'Shoes',
    });
  });
});

describe('itemListJsonLd', () => {
  it('returns null for an empty listing (never emit an empty ItemList)', () => {
    expect(itemListJsonLd('https://shop.test', [])).toBeNull();
  });

  it('lists rendered products in on-page order with canonical URLs', () => {
    const ld = itemListJsonLd(
      'https://shop.test',
      [
        { name: 'Red Shoes', slug: 'red-shoes' },
        { name: 'Blue Shoes', slug: 'blue-shoes' },
      ],
      'Shoes'
    ) as {
      '@type': string;
      itemListElement: Array<{ position: number; name: string; url: string }>;
    };
    expect(ld).not.toBeNull();
    expect(ld['@type']).toBe('ItemList');
    expect(ld.itemListElement).toEqual([
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Red Shoes',
        url: 'https://shop.test/products/red-shoes',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Blue Shoes',
        url: 'https://shop.test/products/blue-shoes',
      },
    ]);
  });
});
