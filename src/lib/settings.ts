import { z } from 'zod';
import { prisma } from './db';

/**
 * Store settings: typed key-value configuration stored in the database,
 * editable from the admin panel, cached in-process for 30 seconds.
 *
 * Defaults are safe placeholders - the SETUP_CHECKLIST requires the owner to
 * review business/legal fields (GSTIN, legal name, policies) before launch.
 */

export const settingsSchema = z.object({
  storeName: z.string().min(1).max(80),
  storeTagline: z.string().max(160).default(''),
  supportEmail: z.string().email().max(160),
  supportPhone: z.string().max(32).default(''),
  currency: z.literal('INR'),
  demoMode: z.boolean().default(true),
  announcement: z
    .object({ enabled: z.boolean(), text: z.string().max(200) })
    .nullable()
    .default(null),

  business: z
    .object({
      legalName: z.string().max(160).default(''),
      gstin: z.string().max(32).default(''),
      addressLine: z.string().max(200).default(''),
      city: z.string().max(80).default(''),
      state: z.string().max(80).default(''),
      postalCode: z.string().max(16).default(''),
    })
    .default({
      legalName: '',
      gstin: '',
      addressLine: '',
      city: '',
      state: '',
      postalCode: '',
    }),

  payments: z
    .object({
      // Estimated gateway fee used for profit forecasts. Actual fees recorded
      // from provider payloads override this per payment.
      feePercent: z.number().min(0).max(15).default(2),
      feeFixedPaise: z.number().int().min(0).max(100000).default(0),
    })
    .default({ feePercent: 2, feeFixedPaise: 0 }),

  pricing: z
    .object({
      // Minimum EFFECTIVE margin (margin on selling price, percent) that the
      // store must never silently go below. Discount/coupon engine caps
      // discounts at this floor unless a coupon explicitly bypasses it.
      minMarginPercent: z.number().min(0).max(90).default(10),
      minProfitPaise: z.number().int().min(0).max(5_000_000).default(5000),
      minSellingPricePaise: z.number().int().min(0).max(50_000_000).default(9900),
      maxSellingPricePaise: z.number().int().min(0).max(100_000_000).default(5_000_000),
      defaultMarkupPercent: z.number().min(0).max(500).default(40),
      defaultRoundingRule: z.enum(['NONE', 'ROUND_UP_10', 'NEAREST_9', 'NEAREST_99']).default('NEAREST_99'),
      marginProtectionEnabled: z.boolean().default(true),
      // Expected return / RTO reserve, packaging and operational overheads
      // added to landed cost before margin is applied (paise / percent).
      returnReservePercent: z.number().min(0).max(50).default(0),
      packagingPaise: z.number().int().min(0).max(100000).default(0),
      operationalPaise: z.number().int().min(0).max(100000).default(0),
      // Global cap on any single discount (percent of eligible subtotal).
      maxDiscountPercent: z.number().min(0).max(90).default(90),
    })
    .default({
      minMarginPercent: 10,
      minProfitPaise: 5000,
      minSellingPricePaise: 9900,
      maxSellingPricePaise: 5_000_000,
      defaultMarkupPercent: 40,
      defaultRoundingRule: 'NEAREST_99',
      marginProtectionEnabled: true,
      returnReservePercent: 0,
      packagingPaise: 0,
      operationalPaise: 0,
      maxDiscountPercent: 90,
    }),

  autoImport: z
    .object({
      enabled: z.boolean().default(true),
      autoPublishEligible: z.boolean().default(false),
      minMarginPercent: z.number().min(0).max(90).default(15),
      minProfitPaise: z.number().int().min(0).max(5_000_000).default(5000),
      maxLandedCostPaise: z.number().int().min(0).max(50_000_000).default(1_500_000),
      minSellingPricePaise: z.number().int().min(0).max(50_000_000).default(9900),
      maxSellingPricePaise: z.number().int().min(0).max(100_000_000).default(2_500_000),
      dailyImportLimit: z.number().int().min(1).max(2000).default(100),
      allowedCategories: z.array(z.string()).default([]),
      excludedCategories: z.array(z.string()).default([]),
      requireVerifiedStock: z.boolean().default(true),
      requireValidImages: z.boolean().default(true),
      minDescriptionLength: z.number().int().min(10).max(2000).default(20),
      codMaxPricePaise: z.number().int().min(0).max(50_000_000).default(500_000),
      supplierLiveOrderingEnabled: z.boolean().default(false),
      rankingWeights: z
        .object({
          costAndMargin: z.number().min(0).max(100).default(25),
          shippingAndFulfilment: z.number().min(0).max(100).default(20),
          stockReliability: z.number().min(0).max(100).default(15),
          contentAndImagery: z.number().min(0).max(100).default(15),
          lowReturnRiskAndCompliance: z.number().min(0).max(100).default(15),
          codAndMarketFit: z.number().min(0).max(100).default(10),
        })
        .default({
          costAndMargin: 25,
          shippingAndFulfilment: 20,
          stockReliability: 15,
          contentAndImagery: 15,
          lowReturnRiskAndCompliance: 15,
          codAndMarketFit: 10,
        }),
    })
    .default({
      enabled: true,
      autoPublishEligible: false,
      minMarginPercent: 15,
      minProfitPaise: 5000,
      maxLandedCostPaise: 1_500_000,
      minSellingPricePaise: 9900,
      maxSellingPricePaise: 2_500_000,
      dailyImportLimit: 100,
      allowedCategories: [],
      excludedCategories: [],
      requireVerifiedStock: true,
      requireValidImages: true,
      minDescriptionLength: 20,
      codMaxPricePaise: 500_000,
      supplierLiveOrderingEnabled: false,
      rankingWeights: {
        costAndMargin: 25,
        shippingAndFulfilment: 20,
        stockReliability: 15,
        contentAndImagery: 15,
        lowReturnRiskAndCompliance: 15,
        codAndMarketFit: 10,
      },
    }),

  shipping: z
    .object({
      flatRatePaise: z.number().int().min(0).max(1000000).default(4900),
      freeAbovePaise: z.number().int().min(0).max(100000000).default(99900),
      codEnabled: z.boolean().default(false),
      codFeePaise: z.number().int().min(0).max(100000).default(0),
      estimatedDaysMin: z.number().int().min(0).max(60).default(3),
      estimatedDaysMax: z.number().int().min(0).max(90).default(7),
    })
    .default({
      flatRatePaise: 4900,
      freeAbovePaise: 99900,
      codEnabled: false,
      codFeePaise: 0,
      estimatedDaysMin: 3,
      estimatedDaysMax: 7,
    }),

  tax: z
    .object({
      defaultGstPercent: z.number().min(0).max(40).default(0),
      pricesIncludeTax: z.boolean().default(true),
      invoicePrefix: z.string().max(16).default('INV'),
    })
    .default({ defaultGstPercent: 0, pricesIncludeTax: true, invoicePrefix: 'INV' }),

  policies: z
    .object({
      returnWindowDays: z.number().int().min(0).max(90).default(7),
      cancellationWindowHours: z.number().int().min(0).max(720).default(24),
    })
    .default({ returnWindowDays: 7, cancellationWindowHours: 24 }),

  social: z
    .object({
      instagram: z.string().max(300).default(''),
      facebook: z.string().max(300).default(''),
      youtube: z.string().max(300).default(''),
    })
    .default({ instagram: '', facebook: '', youtube: '' }),
});

export type StoreSettings = z.infer<typeof settingsSchema>;

/**
 * `support@example.com` is the shipped default, not a real mailbox. Public
 * pages must never advertise it and notifications must never be sent to it.
 * (RFC 2606 reserves example.com/.net/.org for documentation.)
 */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return true;
  return /@(?:[a-z0-9-]+\.)*example\.(?:com|net|org)$/i.test(email.trim());
}

/** The configured support address, or null while it is still the placeholder. */
export function configuredSupportEmail(settings: Pick<StoreSettings, 'supportEmail'>): string | null {
  return isPlaceholderEmail(settings.supportEmail) ? null : settings.supportEmail.trim();
}

const SETTINGS_KEY = 'store';
const CACHE_TTL_MS = 30_000;

let cache: { data: StoreSettings; at: number } | null = null;

const FALLBACK: StoreSettings = settingsSchema.parse({
  storeName: process.env.APP_NAME ?? 'Zenvora',
  supportEmail: 'support@example.com',
  currency: 'INR',
});

export async function getSettings(): Promise<StoreSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
    const data = row ? settingsSchema.parse(mergeDefaults(row.value)) : FALLBACK;
    cache = { data, at: Date.now() };
    return data;
  } catch {
    // Database may be unreachable (e.g. during setup); fall back to defaults.
    return FALLBACK;
  }
}

function mergeDefaults(value: unknown): unknown {
  // settingsSchema.parse applies defaults for missing keys, so a partial
  // stored object upgrades cleanly when new settings are introduced.
  return value;
}

export async function updateSettings(patch: unknown): Promise<StoreSettings> {
  const current = await getSettings();
  const candidate = deepMerge(current, patch);
  const validated = settingsSchema.parse(candidate);
  await prisma.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: validated as unknown as object },
    update: { value: validated as unknown as object },
  });
  cache = { data: validated, at: Date.now() };
  return validated;
}

export function invalidateSettingsCache(): void {
  cache = null;
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return (patch === undefined ? base : patch) as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const baseValue = out[key];
    out[key] =
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      baseValue !== null &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue)
        ? deepMerge(baseValue, value)
        : value;
  }
  return out as T;
}
