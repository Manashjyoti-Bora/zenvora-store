import { prisma } from '../db';
import { slugify } from '../utils';
import { productInputSchema } from '../validation/schemas';
import { saveProduct } from './products';
import type { Actor } from './types';

/**
 * CSV product import (admin tool).
 *
 * Expected headers (order-independent, `*` = required):
 *   name*, description*, sku, brand, category, supplier, supplierSku,
 *   supplierCost*, supplierShipping, otherCost, pricingMode, fixedPrice,
 *   fixedMargin, percentMarkup, minProfit, roundingRule, taxRatePercent,
 *   compareAtPrice, status, stock, stockMode, imageUrl, slug
 *
 * Rows with a `sku` matching an existing product UPDATE it; others CREATE.
 * Every row is validated with the same schema as the product form - failures
 * are reported per row without aborting the rest of the import.
 */

export interface ImportRowResult {
  row: number;
  name?: string;
  sku?: string;
  status: 'created' | 'updated' | 'error';
  message?: string;
}

export interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  failed: number;
  results: ImportRowResult[];
}

export async function importProductsCsv(csvText: string, actor: Actor): Promise<ImportSummary> {
  const rows = parseCsv(csvText);
  const summary: ImportSummary = { total: 0, created: 0, updated: 0, failed: 0, results: [] };
  if (rows.length < 2) {
    return {
      ...summary,
      results: [
        {
          row: 0,
          status: 'error',
          message: 'CSV must contain a header row and at least one data row',
        },
      ],
      failed: 1,
      total: 1,
    };
  }

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  summary.total = rows.length - 1;

  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r];
    if (raw.every((c) => !c.trim())) continue;
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = (raw[i] ?? '').trim();
    });
    const name = record.name;
    const sku = record.sku || undefined;
    try {
      const input = await buildProductInput(record);
      const existing = sku ? await prisma.product.findUnique({ where: { sku } }) : null;
      const result = await saveProduct({ ...input, id: existing?.id }, actor);
      summary.results.push({
        row: r + 1,
        name,
        sku,
        status: existing ? 'updated' : 'created',
        message: `slug: ${result.slug}`,
      });
      if (existing) summary.updated += 1;
      else summary.created += 1;
    } catch (err) {
      summary.failed += 1;
      summary.results.push({
        row: r + 1,
        name,
        sku,
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

async function buildProductInput(rec: Record<string, string>) {
  const num = (key: string, fallback = 0): number => {
    const v = rec[key];
    if (v === undefined || v === '') return fallback;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0)
      throw new Error(`Column "${key}" must be a non-negative number (got "${v}")`);
    return n;
  };

  const category = rec.category
    ? await prisma.category.findFirst({
        where: {
          OR: [
            { slug: slugify(rec.category) },
            { name: { equals: rec.category, mode: 'insensitive' } },
          ],
        },
      })
    : null;
  if (rec.category && !category) {
    throw new Error(`Category "${rec.category}" not found - create it first`);
  }
  const supplier = rec.supplier
    ? await prisma.supplier.findFirst({
        where: {
          OR: [
            { slug: slugify(rec.supplier) },
            { name: { equals: rec.supplier, mode: 'insensitive' } },
          ],
        },
      })
    : null;
  if (rec.supplier && !supplier) {
    throw new Error(`Supplier "${rec.supplier}" not found - create it first`);
  }

  const pricingMode = (rec.pricingmode || 'PERCENT_MARKUP').toUpperCase();
  if (!['FIXED_PRICE', 'FIXED_MARGIN', 'PERCENT_MARKUP'].includes(pricingMode)) {
    throw new Error(`Invalid pricingMode "${rec.pricingmode}"`);
  }

  const candidate = {
    name: rec.name,
    slug: rec.slug || '',
    description: rec.description,
    sku: rec.sku || null,
    brand: rec.brand || null,
    status: (rec.status || 'DRAFT').toUpperCase(),
    categoryId: category?.id ?? null,
    supplierId: supplier?.id ?? null,
    supplierSku: rec.suppliersku || null,
    stockMode: (rec.stockmode || 'SUPPLIER_SYNC').toUpperCase(),
    supplierCost: num('suppliercost'),
    supplierShippingCost: num('suppliershipping', 0),
    otherCost: num('othercost', 0),
    pricingMode,
    fixedPrice: rec.fixedprice !== '' && rec.fixedprice !== undefined ? num('fixedprice') : null,
    fixedMargin:
      rec.fixedmargin !== '' && rec.fixedmargin !== undefined ? num('fixedmargin') : null,
    percentMarkup:
      rec.percentmarkup !== '' && rec.percentmarkup !== undefined ? num('percentmarkup') : null,
    minProfit: rec.minprofit !== '' && rec.minprofit !== undefined ? num('minprofit') : null,
    roundingRule: (rec.roundingrule || 'ROUND_UP_10').toUpperCase(),
    compareAtPrice:
      rec.compareatprice !== '' && rec.compareatprice !== undefined ? num('compareatprice') : null,
    taxRatePercent: num('taxratepercent', 0),
    stock: Math.round(num('stock', 0)),
    images: rec.imageurl
      ? [{ url: rec.imageurl, alt: rec.name, isPrimary: true, position: 0 }]
      : [],
    variants: [],
  };

  const parsed = productInputSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Minimal RFC4180-style CSV parser (quotes, escaped quotes, CRLF).
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const clean = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // ignore; \n follows
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
