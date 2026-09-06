import { z } from 'zod';

/**
 * Shared Zod validation schemas used by BOTH client forms (instant feedback)
 * and server API routes (authoritative validation). The server never trusts
 * client validation.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(160);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .refine((p) => /[a-zA-Z]/.test(p), 'Password must contain a letter')
  .refine((p) => /[0-9]/.test(p), 'Password must contain a number');

export const nameSchema = z.string().trim().min(2, 'Name is required').max(80);

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(?:\+91[- ]?)?[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number');

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema.optional().or(z.literal('')),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(72),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
});

export const updateProfileSchema = z.object({
  name: nameSchema,
  phone: phoneSchema.optional().or(z.literal('')).nullable(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: passwordSchema,
});

export const addressSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().max(40).optional().or(z.literal('')),
  fullName: nameSchema,
  phone: phoneSchema,
  line1: z.string().trim().min(4, 'Address line 1 is required').max(200),
  line2: z.string().trim().max(200).optional().or(z.literal('')),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  postalCode: z
    .string()
    .trim()
    .regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit Indian PIN code'),
  country: z.string().trim().length(2).default('IN'),
  isDefaultShipping: z.boolean().optional().default(false),
});

export const quantitySchema = z.number().int().min(1).max(20);

export const addToCartSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).nullable().optional(),
  quantity: quantitySchema.default(1),
});

export const updateCartItemSchema = z.object({
  itemId: z.string().min(1),
  quantity: quantitySchema,
});

export const checkoutSchema = z.object({
  paymentMethod: z.enum(['PREPAID_GATEWAY', 'COD']),
  address: addressSchema,
  couponCode: z.string().trim().max(40).optional().or(z.literal('')).nullable(),
  customerNote: z.string().trim().max(500).optional().or(z.literal('')).nullable(),
  guest: z
    .object({ email: emailSchema, name: nameSchema, phone: phoneSchema })
    .optional()
    .nullable(),
  idempotencyKey: z
    .string()
    .min(8)
    .max(80)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export const createPaymentSchema = z.object({
  orderNumber: z.string().min(4).max(40),
  // Guest checkouts prove ownership with the email used on the order.
  email: emailSchema.optional(),
});

export const verifyPaymentSchema = z.object({
  orderNumber: z.string().min(4).max(40),
  providerOrderId: z.string().min(1).max(120),
  providerPaymentId: z.string().min(1).max(120).optional(),
  signature: z.string().min(1).max(512).optional(),
  email: emailSchema.optional(),
});

export const testSimulatePaymentSchema = z.object({
  orderNumber: z.string().min(4).max(40),
  outcome: z.enum(['success', 'failure']),
  // Guest checkouts prove ownership with the order email (same as payments API).
  email: emailSchema.optional(),
});

export const guestTrackSchema = z.object({
  orderNumber: z.string().trim().min(4).max(40),
  email: emailSchema,
});

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

export const returnRequestSchema = z.object({
  orderItemId: z.string().min(1).optional().nullable(),
  reason: z.string().trim().min(3).max(300),
  note: z.string().trim().max(1000).optional().or(z.literal('')).nullable(),
});

export const contactSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  subject: z.string().trim().max(120).optional().or(z.literal('')),
  message: z.string().trim().min(10, 'Message must be at least 10 characters').max(3000),
});

// ---------------------------------------------------------------------------
// Admin schemas
// ---------------------------------------------------------------------------

const rupees = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number` })
    .nonnegative(`${label} cannot be negative`)
    .max(10_000_000, `${label} is too large`)
    .transform((v) => Math.round(v * 100)); // -> paise

const optionalRupees = (label: string) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v) => (v === '' || v === null || v === undefined ? null : Number(v)))
    .pipe(
      z
        .number()
        .nonnegative(`${label} cannot be negative`)
        .max(10_000_000)
        .transform((v) => Math.round(v * 100))
        .nullable()
        .optional()
    );

export const percentSchema = (max = 1000) =>
  z.coerce
    .number()
    .min(0)
    .max(max)
    .transform((v) => Number(v.toFixed(4)));

export const productImageSchema = z.object({
  id: z.string().optional(),
  url: z.string().trim().min(1).max(2000),
  alt: z.string().trim().max(200).optional().or(z.literal('')),
  videoUrl: z.string().trim().max(2000).optional().or(z.literal('')).nullable(),
  position: z.number().int().min(0).max(999).default(0),
  isPrimary: z.boolean().default(false),
});

export const variantInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  sku: z.string().trim().max(64).optional().or(z.literal('')).nullable(),
  size: z.string().trim().max(40).optional().or(z.literal('')).nullable(),
  color: z.string().trim().max(40).optional().or(z.literal('')).nullable(),
  supplierCost: optionalRupees('Variant supplier cost'),
  sellingPrice: optionalRupees('Variant selling price'),
  compareAtPrice: optionalRupees('Variant compare-at price'),
  taxRatePercent: percentSchema(40).optional().nullable(),
  stock: z.coerce.number().int().min(0).max(1_000_000).default(0),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export const productInputSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().trim().min(2, 'Product name is required').max(200),
    slug: z.string().trim().max(90).optional().or(z.literal('')),
    description: z.string().trim().min(10, 'Description is required').max(20000),
    shortDescription: z.string().trim().max(500).optional().or(z.literal('')).nullable(),
    sku: z.string().trim().max(64).optional().or(z.literal('')).nullable(),
    brand: z.string().trim().max(80).optional().or(z.literal('')).nullable(),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
    categoryId: z.string().min(1).optional().nullable(),
    supplierId: z.string().min(1).optional().nullable(),
    supplierSku: z.string().trim().max(120).optional().or(z.literal('')).nullable(),
    stockMode: z.enum(['SUPPLIER_SYNC', 'LOCAL']).default('SUPPLIER_SYNC'),
    supplierCost: rupees('Supplier cost'),
    supplierShippingCost: rupees('Supplier shipping cost').default(0),
    otherCost: rupees('Other cost').default(0),
    pricingMode: z
      .enum(['FIXED_PRICE', 'FIXED_MARGIN', 'PERCENT_MARKUP'])
      .default('PERCENT_MARKUP'),
    fixedPrice: optionalRupees('Fixed selling price'),
    fixedMargin: optionalRupees('Fixed margin'),
    percentMarkup: percentSchema(1000).optional().nullable(),
    minProfit: optionalRupees('Minimum profit'),
    roundingRule: z.enum(['NONE', 'ROUND_UP_10', 'NEAREST_9', 'NEAREST_99']).default('ROUND_UP_10'),
    compareAtPrice: optionalRupees('Compare-at price'),
    taxRatePercent: percentSchema(40).default(0),
    weightGrams: z.coerce.number().int().min(0).max(100000).optional().nullable(),
    lengthCm: optionalRupees('Length').optional().nullable(),
    widthCm: optionalRupees('Width').optional().nullable(),
    heightCm: optionalRupees('Height').optional().nullable(),
    seoTitle: z.string().trim().max(70).optional().or(z.literal('')).nullable(),
    seoDescription: z.string().trim().max(160).optional().or(z.literal('')).nullable(),
    images: z.array(productImageSchema).max(12).default([]),
    variants: z.array(variantInputSchema).max(60).default([]),
  })
  .superRefine((data, ctx) => {
    if (
      data.pricingMode === 'FIXED_PRICE' &&
      (data.fixedPrice === null || data.fixedPrice === undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['fixedPrice'],
        message: 'Fixed selling price is required',
      });
    }
    if (
      data.pricingMode === 'FIXED_MARGIN' &&
      (data.fixedMargin === null || data.fixedMargin === undefined)
    ) {
      ctx.addIssue({ code: 'custom', path: ['fixedMargin'], message: 'Fixed margin is required' });
    }
    if (
      data.pricingMode === 'PERCENT_MARKUP' &&
      (data.percentMarkup === null || data.percentMarkup === undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['percentMarkup'],
        message: 'Markup percent is required',
      });
    }
  });

export const categoryInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().max(90).optional().or(z.literal('')),
  description: z.string().trim().max(1000).optional().or(z.literal('')).nullable(),
  parentId: z.string().min(1).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
  seoTitle: z.string().trim().max(70).optional().or(z.literal('')).nullable(),
  seoDescription: z.string().trim().max(160).optional().or(z.literal('')).nullable(),
});

export const supplierInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(90).optional().or(z.literal('')),
  type: z.enum(['MANUAL', 'HTTP_REST', 'CJ', 'DEMO']).default('MANUAL'),
  contactEmail: emailSchema.optional().or(z.literal('')).nullable(),
  contactPhone: z.string().trim().max(32).optional().or(z.literal('')).nullable(),
  baseUrl: z.string().trim().url().max(500).optional().or(z.literal('')).nullable(),
  apiKeyEnvVar: z
    .string()
    .trim()
    .max(80)
    .regex(/^[A-Z0-9_]*$/, 'Use UPPER_SNAKE_CASE env var names')
    .optional()
    .or(z.literal(''))
    .nullable(),
  apiSecretEnvVar: z
    .string()
    .trim()
    .max(80)
    .regex(/^[A-Z0-9_]*$/)
    .optional()
    .or(z.literal(''))
    .nullable(),
  config: z.string().max(8000).optional().or(z.literal('')).nullable(), // JSON text
  leadTimeDays: z.coerce.number().int().min(0).max(120).default(3),
  isActive: z.boolean().default(true),
  notes: z.string().trim().max(2000).optional().or(z.literal('')).nullable(),
});

export const supplierProductMapSchema = z.object({
  supplierProductId: z.string().min(1),
  productId: z.string().min(1).nullable(),
  supplierCost: rupees('Supplier cost').optional(),
});

export const pricingRuleInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(120),
  scope: z.enum(['GLOBAL', 'SUPPLIER', 'CATEGORY', 'PRODUCT']).default('GLOBAL'),
  supplierId: z.string().min(1).optional().nullable(),
  categoryId: z.string().min(1).optional().nullable(),
  productId: z.string().min(1).optional().nullable(),
  // Rules support margin-based modes only (a rule cannot carry a fixed price).
  mode: z.enum(['FIXED_MARGIN', 'PERCENT_MARKUP']).default('PERCENT_MARKUP'),
  fixedMargin: optionalRupees('Fixed margin'),
  percentMarkup: percentSchema(1000).optional().nullable(),
  minProfit: optionalRupees('Minimum profit'),
  roundingRule: z.enum(['NONE', 'ROUND_UP_10', 'NEAREST_9', 'NEAREST_99']).default('ROUND_UP_10'),
  priority: z.coerce.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

export const couponBaseSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(3)
    .max(24)
    .regex(/^[A-Z0-9_-]+$/, 'Use letters, numbers, dash or underscore'),
  description: z.string().trim().max(300).optional().or(z.literal('')).nullable(),
  type: z.enum(['PERCENT', 'FIXED']),
  value: z.coerce.number().positive('Value must be positive').max(10_000_000),
  scope: z.enum(['ALL_PRODUCTS', 'CATEGORY']).default('ALL_PRODUCTS'),
  categoryId: z.string().min(1).optional().nullable(),
  minOrderAmount: z.coerce.number().min(0).max(10_000_000).optional().nullable(),
  maxDiscountAmount: z.coerce.number().min(0).max(10_000_000).optional().nullable(),
  usageLimit: z.coerce.number().int().min(1).max(1_000_000).optional().nullable(),
  perUserLimit: z.coerce.number().int().min(1).max(1000).default(1),
  startsAt: z.string().datetime({ offset: true }).optional().nullable(),
  endsAt: z.string().datetime({ offset: true }).optional().nullable(),
  isActive: z.boolean().default(true),
});

export const couponInputSchema = couponBaseSchema.superRefine((data, ctx) => {
  if (data.type === 'PERCENT' && data.value > 100) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: 'Percent discount cannot exceed 100',
    });
  }
  if (data.scope === 'CATEGORY' && !data.categoryId) {
    ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Category is required' });
  }
});

export const refundCreateSchema = z.object({
  orderId: z.string().min(1),
  amount: z.coerce.number().positive('Refund amount must be positive').max(10_000_000),
  reason: z.string().trim().min(3).max(300),
  returnRequestId: z.string().min(1).optional().nullable(),
});

export const returnDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'MARK_RECEIVED', 'CLOSE']),
  adminNote: z.string().trim().max(1000).optional().or(z.literal('')).nullable(),
  refundAmount: z.coerce.number().min(0).max(10_000_000).optional().nullable(),
});

export const shipmentUpdateSchema = z.object({
  orderId: z.string().min(1),
  supplierOrderId: z.string().min(1).optional().nullable(),
  carrier: z.string().trim().max(120).optional().or(z.literal('')).nullable(),
  trackingNumber: z.string().trim().max(120).optional().or(z.literal('')).nullable(),
  trackingUrl: z.string().trim().max(500).url().optional().or(z.literal('')).nullable(),
  status: z.enum([
    'PENDING',
    'IN_TRANSIT',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'EXCEPTION',
    'RETURNED',
  ]),
  message: z.string().trim().max(300).optional().or(z.literal('')).nullable(),
});

export const adminOrderCancelSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().trim().min(3).max(300),
  refund: z.boolean().default(false),
});

export const userRoleUpdateSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['CUSTOMER', 'STAFF', 'ADMIN']),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});

export const adminCreateUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['STAFF', 'ADMIN']),
});

export const inventoryUpdateSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).optional().nullable(),
  stock: z.coerce.number().int().min(0).max(1_000_000).optional().nullable(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional().nullable(),
  variantActive: z.boolean().optional().nullable(),
});

export const repriceSchema = z.object({
  scope: z.enum(['ALL', 'CATEGORY', 'SUPPLIER']),
  categoryId: z.string().min(1).optional().nullable(),
  supplierId: z.string().min(1).optional().nullable(),
  apply: z.boolean().default(false), // false = preview only
});
