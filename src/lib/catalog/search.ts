import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { toPaise } from '../money';

/**
 * Catalogue search helpers shared by the /search page, the header typeahead
 * (`/api/search/suggest`) and the "no results" alternatives.
 *
 * Everything here reads the live catalogue — suggestions are never invented.
 */

export const SEARCH_QUERY_MAX_LENGTH = 80;
export const SEARCH_MIN_CHARS = 2;
const MAX_TOKENS = 6;

/** Split a free-text query into lower-cased tokens (letters/digits/-/+/.). */
export function tokenizeSearchQuery(q: string | null | undefined): string[] {
  if (!q) return [];
  const cleaned = q
    .slice(0, SEARCH_QUERY_MAX_LENGTH)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\-+.]+/gu, ' ')
    .trim();
  if (!cleaned) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of cleaned.split(/\s+/)) {
    const t = raw.replace(/^[-+.]+|[-+.]+$/g, '');
    if (t.length < 1 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TOKENS) break;
  }
  return out;
}

function tokenMatch(token: string): Prisma.ProductWhereInput {
  const ci = { contains: token, mode: 'insensitive' as const };
  return {
    OR: [
      { name: ci },
      { slug: ci },
      { brand: ci },
      { sku: ci },
      { shortDescription: ci },
      { description: ci },
      { category: { is: { name: ci } } },
    ],
  };
}

/**
 * Where-clause for a storefront search. Every token must match somewhere on
 * the product (AND of per-token ORs) so "usb charger" finds "USB-C Fast
 * Charger 65W" — a plain phrase `contains` would not.
 * Returns `null` when the query has no usable tokens.
 */
export function buildSearchWhere(q: string | null | undefined): Prisma.ProductWhereInput | null {
  const tokens = tokenizeSearchQuery(q);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return tokenMatch(tokens[0]!);
  return { AND: tokens.map(tokenMatch) };
}

/** Relaxed variant — ANY token matches. Used only for alternatives. */
function buildAnyTokenWhere(tokens: string[]): Prisma.ProductWhereInput | null {
  if (tokens.length === 0) return null;
  return { OR: tokens.map(tokenMatch) };
}

/** Products the storefront may show at all (same gate as listings). */
export const storefrontVisibleWhere: Prisma.ProductWhereInput = {
  status: 'ACTIVE',
  sellingPrice: { gt: '0' },
};

export interface SearchSuggestion {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  pricePaise: number;
  imageUrl: string | null;
  categoryName: string | null;
}

export interface CategorySuggestion {
  slug: string;
  name: string;
  productCount: number;
}

export interface SuggestResult {
  query: string;
  products: SearchSuggestion[];
  categories: CategorySuggestion[];
}

const suggestionSelect = {
  id: true,
  slug: true,
  name: true,
  brand: true,
  sellingPrice: true,
  images: {
    orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }] as Prisma.ProductImageOrderByWithRelationInput[],
    take: 1,
    select: { url: true },
  },
  category: { select: { name: true } },
} satisfies Prisma.ProductSelect;

type SuggestionRow = Prisma.ProductGetPayload<{ select: typeof suggestionSelect }>;

function toSuggestion(p: SuggestionRow): SearchSuggestion {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand ?? null,
    pricePaise: toPaise(p.sellingPrice),
    imageUrl: p.images[0]?.url ?? null,
    categoryName: p.category?.name ?? null,
  };
}

/**
 * Typeahead for the header search box. Cheap (one indexed-ish query for
 * products, one for categories), bounded, and only over visible products.
 */
export async function suggestSearch(
  rawQuery: string,
  opts: { limit?: number } = {}
): Promise<SuggestResult> {
  const query = (rawQuery ?? '').trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
  const limit = Math.min(Math.max(opts.limit ?? 6, 1), 10);
  const where = buildSearchWhere(query);
  if (!where || query.length < SEARCH_MIN_CHARS) {
    return { query, products: [], categories: [] };
  }
  const tokens = tokenizeSearchQuery(query);
  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: { AND: [storefrontVisibleWhere, where] },
      select: suggestionSelect,
      orderBy: [{ sortOrder: 'desc' }, { viewCount: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    }),
    prisma.category.findMany({
      where: {
        isActive: true,
        OR: tokens.map((t) => ({ name: { contains: t, mode: 'insensitive' as const } })),
        products: { some: storefrontVisibleWhere },
      },
      select: {
        slug: true,
        name: true,
        _count: { select: { products: { where: storefrontVisibleWhere } } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: 3,
    }),
  ]);
  return {
    query,
    products: products.map(toSuggestion),
    categories: categories.map((c) => ({
      slug: c.slug,
      name: c.name,
      productCount: c._count.products,
    })),
  };
}

export interface SearchAlternatives {
  /** Products matching ANY of the query words (strict search matched none). */
  partialMatches: SearchSuggestion[];
  /** Tokens that matched at least one visible product on their own. */
  matchedTokens: string[];
  /** Categories whose name relates to the query. */
  categories: CategorySuggestion[];
  /** Fallback: what the store currently features (only if nothing else). */
  featured: SearchSuggestion[];
}

/**
 * Real-data alternatives for an empty result page. Order of preference:
 * partial (any-word) matches → related categories → currently featured items.
 * Never fabricates — every entry is a live, visible catalogue row.
 */
export async function findSearchAlternatives(
  rawQuery: string,
  opts: { limit?: number } = {}
): Promise<SearchAlternatives> {
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 12);
  const tokens = tokenizeSearchQuery(rawQuery);
  const anyWhere = buildAnyTokenWhere(tokens);

  const [partial, perToken, categories] = await Promise.all([
    anyWhere
      ? prisma.product.findMany({
          where: { AND: [storefrontVisibleWhere, anyWhere] },
          select: suggestionSelect,
          orderBy: [{ sortOrder: 'desc' }, { viewCount: 'desc' }],
          take: limit,
        })
      : Promise.resolve([] as SuggestionRow[]),
    Promise.all(
      tokens.map(async (t) => ({
        token: t,
        count: await prisma.product.count({
          where: { AND: [storefrontVisibleWhere, tokenMatch(t)] },
        }),
      }))
    ),
    tokens.length
      ? prisma.category.findMany({
          where: {
            isActive: true,
            OR: tokens.map((t) => ({ name: { contains: t, mode: 'insensitive' as const } })),
            products: { some: storefrontVisibleWhere },
          },
          select: {
            slug: true,
            name: true,
            _count: { select: { products: { where: storefrontVisibleWhere } } },
          },
          take: 4,
        })
      : Promise.resolve([]),
  ]);

  const partialMatches = partial.map(toSuggestion);
  const featured =
    partialMatches.length === 0 && categories.length === 0
      ? (
          await prisma.product.findMany({
            where: storefrontVisibleWhere,
            select: suggestionSelect,
            orderBy: [{ sortOrder: 'desc' }, { viewCount: 'desc' }, { createdAt: 'desc' }],
            take: limit,
          })
        ).map(toSuggestion)
      : [];

  return {
    partialMatches,
    matchedTokens: perToken.filter((t) => t.count > 0).map((t) => t.token),
    categories: categories.map((c) => ({
      slug: c.slug,
      name: c.name,
      productCount: c._count.products,
    })),
    featured,
  };
}
