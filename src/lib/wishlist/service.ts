import { cookies } from 'next/headers';
import { prisma } from '../db';
import { badRequest, notFound } from '../errors';
import { toPaise } from '../money';
import { randomToken } from '../crypto';
import { resolveAvailability } from '../catalog/availability';
import type { ProductCardData } from '../catalog/storefront';

/**
 * ============================================================================
 * SERVER-SIDE WISHLIST SERVICE (PostgreSQL-backed for Guests & Signed-in Users)
 * ============================================================================
 *
 * Persisted in PostgreSQL (`settings` table under `wishlist:user:<userId>` or
 * `wishlist:guest:<guestToken>`), identified by an httpOnly cookie for guests
 * and by `userId` once authenticated.
 *
 * Atomic guest-to-user merge runs on login and registration (`attachGuestWishlistToUser`).
 * Unpublished, archived, deleted, or out-of-stock products are handled
 * gracefully without crashing so the customer can see why an item is no longer
 * available and remove it cleanly.
 */

export const WISHLIST_COOKIE = 'zenvora_wishlist';
const WISHLIST_TTL_DAYS = 30;
const MAX_WISHLIST_ITEMS = 100;

export interface StoredWishlistEntry {
  productId: string;
  snapshotName: string;
  snapshotSlug: string | null;
  addedAt: string;
}

interface StoredWishlistPayload {
  items: StoredWishlistEntry[];
  updatedAt: string;
}

export interface WishlistItemView {
  productId: string;
  addedAt: string;
  available: boolean;
  unavailableName: string;
  unavailableSlug: string | null;
  unavailableReason: string | null;
  product: ProductCardData | null;
}

export interface WishlistView {
  items: WishlistItemView[];
  count: number;
  productIds: string[];
}

function userKey(userId: string): string {
  return `wishlist:user:${userId}`;
}

function guestKey(token: string): string {
  return `wishlist:guest:${token}`;
}

function parseStoredPayload(raw: unknown): StoredWishlistEntry[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.items)) return [];
  const seen = new Set<string>();
  const out: StoredWishlistEntry[] = [];
  for (const item of obj.items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const productId = typeof rec.productId === 'string' ? rec.productId.trim() : '';
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    out.push({
      productId,
      snapshotName:
        typeof rec.snapshotName === 'string' && rec.snapshotName.trim()
          ? rec.snapshotName.trim()
          : 'Saved product',
      snapshotSlug: typeof rec.snapshotSlug === 'string' ? rec.snapshotSlug : null,
      addedAt:
        typeof rec.addedAt === 'string' ? rec.addedAt : new Date().toISOString(),
    });
  }
  return out;
}

async function readEntriesByKey(key: string): Promise<StoredWishlistEntry[]> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row ? parseStoredPayload(row.value) : [];
}

async function writeEntriesByKey(key: string, items: StoredWishlistEntry[]): Promise<void> {
  const payload: StoredWishlistPayload = {
    items: items.slice(0, MAX_WISHLIST_ITEMS),
    updatedAt: new Date().toISOString(),
  };
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: payload as unknown as object },
    update: { value: payload as unknown as object },
  });
}

function mergeEntryLists(
  primary: StoredWishlistEntry[],
  secondary: StoredWishlistEntry[]
): StoredWishlistEntry[] {
  const map = new Map<string, StoredWishlistEntry>();
  for (const item of primary) {
    map.set(item.productId, item);
  }
  for (const item of secondary) {
    if (!map.has(item.productId)) {
      map.set(item.productId, item);
    }
  }
  return Array.from(map.values()).slice(0, MAX_WISHLIST_ITEMS);
}

/**
 * Merges a guest wishlist into the signed-in user's wishlist atomically on
 * login or registration, then deletes the guest wishlist record and cookie.
 */
export async function attachGuestWishlistToUser(userId: string): Promise<void> {
  const cookieStore = await cookies();
  const guestToken = cookieStore.get(WISHLIST_COOKIE)?.value;
  if (!guestToken) return;

  const gKey = guestKey(guestToken);
  const uKey = userKey(userId);

  await prisma.$transaction(async (tx) => {
    const [guestRow, userRow] = await Promise.all([
      tx.setting.findUnique({ where: { key: gKey } }),
      tx.setting.findUnique({ where: { key: uKey } }),
    ]);
    const guestItems = guestRow ? parseStoredPayload(guestRow.value) : [];
    if (guestItems.length === 0) {
      if (guestRow) await tx.setting.delete({ where: { key: gKey } });
      return;
    }
    const userItems = userRow ? parseStoredPayload(userRow.value) : [];
    const merged = mergeEntryLists(userItems, guestItems);
    const payload: StoredWishlistPayload = {
      items: merged,
      updatedAt: new Date().toISOString(),
    };
    await tx.setting.upsert({
      where: { key: uKey },
      create: { key: uKey, value: payload as unknown as object },
      update: { value: payload as unknown as object },
    });
    if (guestRow) {
      await tx.setting.delete({ where: { key: gKey } });
    }
  });

  try {
    cookieStore.delete(WISHLIST_COOKIE);
  } catch {
    // ignore in read-only render contexts
  }
}

async function resolveStorageKeyForWrite(userId?: string | null): Promise<string> {
  const cookieStore = await cookies();
  if (userId) {
    const guestToken = cookieStore.get(WISHLIST_COOKIE)?.value;
    if (guestToken) {
      await attachGuestWishlistToUser(userId);
    }
    return userKey(userId);
  }

  let token = cookieStore.get(WISHLIST_COOKIE)?.value;
  if (!token) {
    token = randomToken(24);
    cookieStore.set(WISHLIST_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: WISHLIST_TTL_DAYS * 86_400,
    });
  }
  return guestKey(token);
}

/**
 * Read-only wishlist view safe for Server Components (never mutates cookies).
 */
export async function getWishlistViewReadOnly(userId?: string | null): Promise<WishlistView> {
  const cookieStore = await cookies();
  const guestToken = cookieStore.get(WISHLIST_COOKIE)?.value;

  let entries: StoredWishlistEntry[] = [];
  if (userId) {
    const userEntries = await readEntriesByKey(userKey(userId));
    const guestEntries = guestToken ? await readEntriesByKey(guestKey(guestToken)) : [];
    entries = mergeEntryLists(userEntries, guestEntries);
  } else if (guestToken) {
    entries = await readEntriesByKey(guestKey(guestToken));
  }

  return hydrateWishlistEntries(entries);
}

/**
 * Wishlist view for API routes (merges guest wishlist if user is logged in).
 */
export async function getWishlistView(userId?: string | null): Promise<WishlistView> {
  if (userId) {
    await attachGuestWishlistToUser(userId);
    const entries = await readEntriesByKey(userKey(userId));
    return hydrateWishlistEntries(entries);
  }
  return getWishlistViewReadOnly(null);
}

export async function addToWishlist(params: {
  userId?: string | null;
  productId: string;
}): Promise<WishlistView> {
  const productId = (params.productId ?? '').trim();
  if (!productId) throw badRequest('productId is required');

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, slug: true, status: true, sellingPrice: true },
  });
  if (!product || product.status !== 'ACTIVE' || toPaise(product.sellingPrice) <= 0) {
    throw notFound('Product is not available');
  }

  const key = await resolveStorageKeyForWrite(params.userId);
  const current = await readEntriesByKey(key);
  if (!current.some((e) => e.productId === product.id)) {
    current.unshift({
      productId: product.id,
      snapshotName: product.name,
      snapshotSlug: product.slug,
      addedAt: new Date().toISOString(),
    });
    await writeEntriesByKey(key, current);
  }

  return hydrateWishlistEntries(current);
}

export async function removeFromWishlist(params: {
  userId?: string | null;
  productId: string;
}): Promise<WishlistView> {
  const productId = (params.productId ?? '').trim();
  if (!productId) throw badRequest('productId is required');

  const key = await resolveStorageKeyForWrite(params.userId);
  const current = await readEntriesByKey(key);
  const next = current.filter((e) => e.productId !== productId);
  await writeEntriesByKey(key, next);
  return hydrateWishlistEntries(next);
}

async function hydrateWishlistEntries(entries: StoredWishlistEntry[]): Promise<WishlistView> {
  if (entries.length === 0) {
    return { items: [], count: 0, productIds: [] };
  }

  const productIds = entries.map((e) => e.productId);
  const rows = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      sellingPrice: true,
      compareAtPrice: true,
      stock: true,
      stockMode: true,
      lowStockThreshold: true,
      hasVariants: true,
      category: { select: { name: true } },
      images: {
        orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
        take: 2,
        select: { url: true, alt: true },
      },
      variants: {
        where: { isActive: true },
        select: { sellingPrice: true, stock: true },
      },
      supplierProduct: {
        select: { inStock: true, stockQty: true, lastSyncedAt: true },
      },
    },
  });

  const byId = new Map(rows.map((r) => [r.id, r]));

  const items: WishlistItemView[] = entries.map((entry) => {
    const p = byId.get(entry.productId);
    if (!p || p.status !== 'ACTIVE' || toPaise(p.sellingPrice) <= 0) {
      return {
        productId: entry.productId,
        addedAt: entry.addedAt,
        available: false,
        unavailableName: p?.name ?? entry.snapshotName,
        unavailableSlug: null,
        unavailableReason: 'This product is no longer available in the catalog.',
        product: null,
      };
    }

    const variantPrices = p.variants
      .map((v) => (v.sellingPrice != null ? toPaise(v.sellingPrice) : null))
      .filter((v): v is number => v != null && v > 0);
    const pricePaise =
      variantPrices.length > 0 ? Math.min(...variantPrices) : toPaise(p.sellingPrice);
    const stock = p.hasVariants
      ? p.variants.reduce((acc, v) => acc + v.stock, 0)
      : p.stock;

    const sp = p.supplierProduct ?? null;
    const availability = resolveAvailability({
      isActive: p.status === 'ACTIVE',
      stockMode: p.stockMode,
      stock: p.stock,
      hasVariants: p.hasVariants,
      variants: p.variants.map((v) => ({ stock: v.stock })),
      lowStockThreshold: p.lowStockThreshold,
      supplier: sp
        ? {
            inStock: sp.inStock,
            stockQty: sp.stockQty,
            lastSyncedAt: sp.lastSyncedAt,
          }
        : null,
    });

    const card: ProductCardData = {
      id: p.id,
      slug: p.slug,
      name: p.name,
      imageUrls: p.images.map((i) => i.url),
      imageAlt: p.images[0]?.alt ?? null,
      pricePaise,
      compareAtPricePaise: p.compareAtPrice != null ? toPaise(p.compareAtPrice) : null,
      stock,
      lowStockThreshold: p.lowStockThreshold,
      hasVariants: p.hasVariants,
      categoryName: p.category?.name ?? null,
      availability,
    };

    return {
      productId: p.id,
      addedAt: entry.addedAt,
      available: availability.purchasable,
      unavailableName: p.name,
      unavailableSlug: p.slug,
      unavailableReason: availability.purchasable ? null : availability.label,
      product: card,
    };
  });

  return {
    items,
    count: items.length,
    productIds: items.map((i) => i.productId),
  };
}
