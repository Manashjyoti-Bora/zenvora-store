import { isDemoSupplierAllowed } from '../env';
import { logger } from '../logger';
import type { Supplier } from '@prisma/client';
import type { SupplierAdapter } from './types';
import { ManualAdapter } from './manual';
import { HttpRestAdapter } from './http-rest';
import { CJDropshippingAdapter } from './cj';
import { DemoAdapter } from './demo';

/**
 * Supplier adapter registry - the single place that maps a supplier record to
 * its integration implementation. New suppliers/providers are added here.
 */
export function getSupplierAdapter(supplier: Supplier): SupplierAdapter {
  switch (supplier.type) {
    case 'HTTP_REST':
      try {
        return new HttpRestAdapter(supplier);
      } catch (err) {
        logger.error('HTTP_REST supplier misconfigured - falling back to manual queue', {
          supplier: supplier.slug,
          error: err instanceof Error ? err.message : String(err),
        });
        return new ManualAdapter(supplier);
      }
    case 'CJ':
      try {
        return new CJDropshippingAdapter(supplier);
      } catch (err) {
        logger.error('CJ supplier misconfigured - falling back to manual queue', {
          supplier: supplier.slug,
          error: err instanceof Error ? err.message : String(err),
        });
        return new ManualAdapter(supplier);
      }
    case 'DEMO':
      if (!isDemoSupplierAllowed()) {
        logger.warn('DEMO supplier requested but disabled - falling back to manual queue', {
          supplier: supplier.slug,
        });
        return new ManualAdapter(supplier);
      }
      return new DemoAdapter(supplier);
    case 'MANUAL':
    default:
      return new ManualAdapter(supplier);
  }
}

export { ManualAdapter, HttpRestAdapter, CJDropshippingAdapter, DemoAdapter };
export * from './types';

/** Safe adapter-configuration diagnostics (never includes secret values). */
export interface SupplierAdapterDiagnostics {
  /** true when the supplier's real adapter constructs successfully. */
  ok: boolean;
  adapterType: Supplier['type'];
  /** Precise, secret-free reason when construction fails. */
  error: string | null;
}

/**
 * Try to construct the supplier's REAL adapter (not the manual fallback the
 * registry swaps in for resilience) and report the precise configuration
 * problem. Admin endpoints use this so a misconfigured automated supplier
 * fails loudly with the exact missing configuration instead of silently
 * degrading to manual fulfilment.
 */
export function diagnoseSupplierAdapter(supplier: Supplier): SupplierAdapterDiagnostics {
  try {
    switch (supplier.type) {
      case 'HTTP_REST':
        new HttpRestAdapter(supplier);
        break;
      case 'CJ':
        new CJDropshippingAdapter(supplier);
        break;
      case 'DEMO':
        if (!isDemoSupplierAllowed()) {
          return {
            ok: false,
            adapterType: supplier.type,
            error:
              'DEMO supplier is disabled in this environment (demo supplier mode is off), so it falls back to manual fulfilment.',
          };
        }
        new DemoAdapter(supplier);
        break;
      default:
        // MANUAL (and anything unrecognised) always constructs.
        break;
    }
    return { ok: true, adapterType: supplier.type, error: null };
  } catch (err) {
    return {
      ok: false,
      adapterType: supplier.type,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
