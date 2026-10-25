import { z } from 'zod';
import type { AiCeoReport, AiCeoSnapshot } from './contracts';
import { buildAiCeoReport } from './engine';

/**
 * Typed business tools for the AI CEO.
 *
 * Design rules (deliberate, and enforced by tests):
 *  - a tool reads ONLY from the snapshot that was loaded for the current
 *    request; there is no database handle here, so a tool cannot widen its own
 *    access or run arbitrary SQL;
 *  - inputs are strict zod schemas: unknown keys, oversized limits and
 *    malformed values are rejected before any work happens;
 *  - every tool declares the minimum permission level and is read-only
 *    (`sideEffects: 'NONE'`), so a read tool can never mutate business state;
 *  - the outputs are aggregates. No customer name, e-mail, phone or address is
 *    ever returned, which keeps the surface safe to feed to a model provider.
 */

export type AiCeoLevel = 0 | 1 | 2 | 3 | 4;

export type AiCeoToolName =
  | 'getStoreHealth'
  | 'getVerifiedSalesMetrics'
  | 'getContributionMarginReport'
  | 'getProductQualityReport'
  | 'getSupplierHealth'
  | 'getOrderOperationsSummary'
  | 'getLaunchReadiness'
  | 'getRecommendations'
  | 'getDataGaps';

export interface ToolDefinition {
  name: AiCeoToolName;
  description: string;
  minLevel: AiCeoLevel;
  sideEffects: 'NONE';
  inputSchema: z.ZodTypeAny;
}

export interface ToolRunOk {
  ok: true;
  tool: AiCeoToolName;
  asOf: string;
  sideEffects: 'NONE';
  data: unknown;
}

export interface ToolRunError {
  ok: false;
  tool: string;
  code: 'UNKNOWN_TOOL' | 'FORBIDDEN' | 'INVALID_INPUT';
  message: string;
  issues?: Array<{ path: string; message: string }>;
}

export type ToolRunResult = ToolRunOk | ToolRunError;

const emptyInput = z.object({}).strict();

const priorityInput = z
  .object({
    maxPriority: z.number().int().min(1).max(5).optional(),
    category: z
      .enum(['OPERATIONS', 'CATALOG', 'SUPPLIER', 'COMMERCE', 'READINESS', 'DATA'])
      .optional(),
    limit: z.number().int().min(1).max(25).optional(),
  })
  .strict();

export const TOOLS: Record<AiCeoToolName, ToolDefinition> = {
  getStoreHealth: {
    name: 'getStoreHealth',
    description: 'Overall operational health (payments, orders, jobs, webhooks, errors, catalogue, customers).',
    minLevel: 2,
    sideEffects: 'NONE',
    inputSchema: emptyInput,
  },
  getVerifiedSalesMetrics: {
    name: 'getVerifiedSalesMetrics',
    description: 'Realised revenue, refunds, discounts and order counts with their evidence basis.',
    minLevel: 2,
    sideEffects: 'NONE',
    inputSchema: emptyInput,
  },
  getContributionMarginReport: {
    name: 'getContributionMarginReport',
    description: 'Contribution after recorded variable costs, with cost-coverage caveats.',
    minLevel: 3,
    sideEffects: 'NONE',
    inputSchema: emptyInput,
  },
  getProductQualityReport: {
    name: 'getProductQualityReport',
    description: 'Catalogue completeness, freshness and stock-evidence counts.',
    minLevel: 2,
    sideEffects: 'NONE',
    inputSchema: emptyInput,
  },
  getSupplierHealth: {
    name: 'getSupplierHealth',
    description: 'Supplier sync failures, staleness and linked-item counts.',
    minLevel: 2,
    sideEffects: 'NONE',
    inputSchema: emptyInput,
  },
  getOrderOperationsSummary: {
    name: 'getOrderOperationsSummary',
    description: 'Order pipeline aggregates only — no customer identifiers.',
    minLevel: 2,
    sideEffects: 'NONE',
    inputSchema: emptyInput,
  },
  getLaunchReadiness: {
    name: 'getLaunchReadiness',
    description: 'Launch blockers and owner decisions, with the exact owner action required.',
    minLevel: 2,
    sideEffects: 'NONE',
    inputSchema: emptyInput,
  },
  getRecommendations: {
    name: 'getRecommendations',
    description: 'Evidence-backed recommendations, optionally filtered by priority/category.',
    minLevel: 2,
    sideEffects: 'NONE',
    inputSchema: priorityInput,
  },
  getDataGaps: {
    name: 'getDataGaps',
    description: 'What the system cannot measure yet and therefore will not report.',
    minLevel: 2,
    sideEffects: 'NONE',
    inputSchema: emptyInput,
  },
};

export function isToolName(value: string): value is AiCeoToolName {
  return Object.prototype.hasOwnProperty.call(TOOLS, value);
}

/** Report builder is injected so tests can pin `now`/options. */
export type ReportFactory = (snapshot: AiCeoSnapshot) => AiCeoReport;

export interface RunToolParams {
  name: string;
  input: unknown;
  snapshot: AiCeoSnapshot;
  /** Permission level of the caller, resolved server-side by the route. */
  level: AiCeoLevel;
  buildReport?: ReportFactory;
}

export function runTool({
  name,
  input,
  snapshot,
  level,
  buildReport = (s) => buildAiCeoReport(s),
}: RunToolParams): ToolRunResult {
  if (!isToolName(name)) {
    return {
      ok: false,
      tool: name,
      code: 'UNKNOWN_TOOL',
      message: `Unknown tool. Available tools: ${Object.keys(TOOLS).join(', ')}.`,
    };
  }
  const tool = TOOLS[name];

  // Permission is checked BEFORE input parsing so a low-privilege caller cannot
  // use validation errors to probe the shape of a restricted tool.
  if (level < tool.minLevel) {
    return {
      ok: false,
      tool: name,
      code: 'FORBIDDEN',
      message: `This tool requires permission level ${tool.minLevel}; the current session is level ${level}.`,
    };
  }

  const parsed = tool.inputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      tool: name,
      code: 'INVALID_INPUT',
      message: 'The tool input is invalid.',
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }

  const report = buildReport(snapshot);
  return {
    ok: true,
    tool: name,
    asOf: report.generatedAt,
    sideEffects: 'NONE',
    data: selectData(name, parsed.data, report),
  };
}

function selectData(name: AiCeoToolName, input: unknown, report: AiCeoReport): unknown {
  switch (name) {
    case 'getStoreHealth':
      return {
        overallLevel: report.overallLevel,
        headline: report.headline,
        domains: report.domains.map((d) => ({
          id: d.id,
          label: d.label,
          level: d.level,
          summary: d.summary,
          metrics: d.metrics,
        })),
      };
    case 'getVerifiedSalesMetrics':
      return {
        windowDays: report.sales.windowDays,
        basis: report.sales.basis,
        metrics: report.sales.metrics,
        caveats: report.sales.caveats,
      };
    case 'getContributionMarginReport':
      return {
        windowDays: report.sales.windowDays,
        basis: report.sales.basis,
        costCoverage: report.sales.costCoverage,
        contributionPaise: report.sales.contributionPaise,
        contributionMarginPercent: report.sales.contributionMarginPercent,
        components: {
          netRevenuePaise: report.sales.netRevenuePaise,
          supplierCostPaise: report.sales.supplierCostPaise,
          shippingCostPaise: report.sales.shippingCostPaise,
          paymentFeePaise: report.sales.paymentFeePaise,
          otherCostPaise: report.sales.otherCostPaise,
        },
        caveats: report.sales.caveats,
      };
    case 'getProductQualityReport':
      return { catalog: report.catalog };
    case 'getSupplierHealth':
      return { suppliers: report.suppliers };
    case 'getOrderOperationsSummary': {
      const orders = report.domains.find((d) => d.id === 'orders');
      return {
        level: orders?.level ?? 'UNKNOWN',
        summary: orders?.summary ?? 'no order data',
        metrics: orders?.metrics ?? [],
      };
    }
    case 'getLaunchReadiness':
      return {
        items: report.readiness,
        blockers: report.readiness.filter(
          (i) => i.blocks.includes('LAUNCH') && i.status !== 'PASS'
        ),
      };
    case 'getRecommendations': {
      const opts = input as { maxPriority?: number; category?: string; limit?: number };
      const filtered = report.recommendations.filter(
        (r) =>
          (opts.maxPriority === undefined || r.priority <= opts.maxPriority) &&
          (opts.category === undefined || r.category === opts.category)
      );
      return filtered.slice(0, opts.limit ?? filtered.length);
    }
    case 'getDataGaps':
      return { dataGaps: report.dataGaps, provider: report.provider };
    default: {
      const exhaustive: never = name;
      return exhaustive;
    }
  }
}
