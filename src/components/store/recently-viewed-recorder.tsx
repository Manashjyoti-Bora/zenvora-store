'use client';

import { useEffect } from 'react';
import { useRecentlyViewed, type ViewedProduct } from '@/hooks/use-recently-viewed';

export function RecentlyViewedRecorder({ product }: { product: ViewedProduct }) {
  const { addProduct } = useRecentlyViewed();

  useEffect(() => {
    addProduct(product);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.slug]);

  return null;
}