import { isDemoSupplierAllowed } from '../env';
import { logger } from '../logger';
import type { Supplier } from '@prisma/client';
import type { SupplierAdapter } from './types';
import { ManualAdapter } from './manual';
import { HttpRestAdapter } from './http-rest';
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

export { ManualAdapter, HttpRestAdapter, DemoAdapter };
export * from './types';
