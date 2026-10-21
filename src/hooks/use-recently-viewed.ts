'use client';

import { useState, useEffect } from 'react';

export type ViewedProduct = {
  slug: string;
  name: string;
  price: string;
  imageUrl: string | null;
};

const STORAGE_KEY = 'zenvora_recently_viewed';
const MAX_ITEMS = 6;

export function useRecentlyViewed() {
  const [viewed, setViewed] = useState<ViewedProduct[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setViewed(JSON.parse(stored) as ViewedProduct[]);
      }
    } catch {
      // localStorage unavailable (private mode) or a corrupt payload. The
      // "recently viewed" rail is a progressive enhancement - never break the
      // product page because history could not be read.
    }
  }, []);

  const addProduct = (product: ViewedProduct) => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      let items: ViewedProduct[] = stored ? JSON.parse(stored) : [];
      
      // Remove if exists
      items = items.filter((p) => p.slug !== product.slug);
      
      // Add to front
      items.unshift(product);
      
      // Cap at MAX_ITEMS
      items = items.slice(0, MAX_ITEMS);
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      setViewed(items);
    } catch {
      // Storage unavailable or over quota. Recording history is best-effort:
      // the storefront must keep working without it.
    }
  };

  return { viewed, addProduct };
}