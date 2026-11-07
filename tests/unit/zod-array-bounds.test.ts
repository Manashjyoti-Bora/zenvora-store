import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/env', () => ({ env: { SUPPORT_EMAIL: 'support@example.test' } }));

import { settingsSchema } from '@/lib/settings';

describe('Zod array input bounds', () => {
  it('caps configurable category arrays so validation work stays bounded', () => {
    const autoImportSchema = settingsSchema.shape.autoImport;
    expect(
      autoImportSchema.safeParse({ allowedCategories: Array(500).fill('category') }).success
    ).toBe(true);
    expect(
      autoImportSchema.safeParse({ allowedCategories: Array(501).fill('category') }).success
    ).toBe(false);
    expect(
      autoImportSchema.safeParse({ excludedCategories: Array(501).fill('category') }).success
    ).toBe(false);
  });
});
