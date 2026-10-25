import type { AiCeoSnapshot, ReadinessItem } from './contracts';

/**
 * Launch readiness.
 *
 * Every item is computed from a fact the system actually holds (a setting, an
 * environment variable, a row count) or is explicitly marked UNKNOWN/OWNER
 * DECISION. Nothing here asserts legal compliance: where the obligation is a
 * legal or tax question it is labelled `needsProfessionalAdvice` and the owner
 * action says "get advice", never "you are compliant".
 */

export interface ReadinessInput {
  snapshot: AiCeoSnapshot;
}

export function evaluateReadiness({ snapshot }: ReadinessInput): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  const { store, payments, automation, catalog } = snapshot;

  // --- Money ---------------------------------------------------------------
  if (payments.kind === 'NONE') {
    items.push({
      id: 'payments-configured',
      label: 'Payment provider configured',
      status: 'NOT_CONFIGURED',
      detail: 'No Razorpay key pair is present in the environment, so checkout cannot collect payment.',
      ownerAction: 'Create/verify the Razorpay account, complete the provider’s KYC, and set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET.',
      blocks: ['TESTING', 'DEMO', 'LAUNCH'],
    });
  } else if (payments.isTest || payments.kind === 'TEST') {
    items.push({
      id: 'payments-live',
      label: 'Live payments enabled',
      status: 'OWNER_DECISION',
      detail: 'Payments are running against a test/dev provider. No real money can be captured, which is the safe default.',
      ownerAction: 'After the provider’s account verification and the pre-launch checklist are complete, switch to live keys. This requires explicit owner approval.',
      blocks: ['LAUNCH'],
    });
  } else {
    items.push({
      id: 'payments-live',
      label: 'Live payments enabled',
      status: 'PASS',
      detail: 'A live-capable Razorpay configuration is present and accepted by the environment guard.',
      ownerAction: '',
      blocks: [],
    });
  }

  // --- Contact details -----------------------------------------------------
  items.push(
    store.supportEmailConfigured
      ? {
          id: 'support-email',
          label: 'Support e-mail published',
          status: 'PASS',
          detail: 'A real (non-placeholder) support address is stored in Settings and is safe to show to customers.',
          ownerAction: '',
          blocks: [],
        }
      : {
          id: 'support-email',
          label: 'Support e-mail published',
          status: 'NOT_CONFIGURED',
          detail: 'Settings still holds the placeholder address, so customer-facing pages cannot show a contact route.',
          ownerAction: 'Set Settings → support e-mail to the real support mailbox and keep it monitored.',
          blocks: ['LAUNCH'],
        }
  );

  items.push(
    store.supportPhoneConfigured
      ? {
          id: 'support-phone',
          label: 'Support phone',
          status: 'PASS',
          detail: 'A support phone number is stored in Settings.',
          ownerAction: '',
          blocks: [],
        }
      : {
          id: 'support-phone',
          label: 'Support phone',
          status: 'NOT_CONFIGURED',
          detail: 'No support phone number is configured. This is not mandatory for every selling model, but Indian consumer-protection practice expects a reachable grievance route.',
          ownerAction: 'Decide whether a phone line will be operated. If not, ensure the e-mail route and response commitment are clearly published. Legal review recommended.',
          blocks: [],
          needsProfessionalAdvice: true,
        }
  );

  // --- Business identity ---------------------------------------------------
  if (store.businessIdentity === 'MISSING') {
    items.push({
      id: 'business-identity',
      label: 'Business identity recorded',
      status: 'NOT_CONFIGURED',
      detail: 'Legal name, address and tax identifier are all empty in Settings. Invoices, the contact page and the policy pages cannot state who the seller is.',
      ownerAction: 'Provide the seller’s legal name, full business/contact address and GSTIN status (or a written decision that the business is below the GST registration threshold).',
      blocks: ['LAUNCH'],
      needsProfessionalAdvice: true,
    });
  } else if (store.businessIdentity === 'PARTIAL') {
    items.push({
      id: 'business-identity',
      label: 'Business identity recorded',
      status: 'ACTION_REQUIRED',
      detail: 'Only part of the seller identity (legal name / address / GSTIN) is recorded, so invoices and policies would be incomplete.',
      ownerAction: 'Complete the missing identity fields. GST treatment (registered, composition, or not registered) is an owner/tax-adviser decision.',
      blocks: ['LAUNCH'],
      needsProfessionalAdvice: true,
    });
  } else {
    items.push({
      id: 'business-identity',
      label: 'Business identity recorded',
      status: 'PASS',
      detail: 'Legal name, address and tax identifier are recorded in Settings.',
      ownerAction: '',
      blocks: [],
    });
  }

  // --- Policies ------------------------------------------------------------
  items.push({
    id: 'policies',
    label: 'Return / refund / shipping policies',
    status: 'OWNER_DECISION',
    detail:
      'Policy pages exist in the storefront, but the return window, refund turnaround and shipping promise are business decisions. Their correctness against the actual supplier terms and Indian consumer law has not been verified.',
    ownerAction:
      'Confirm the return window, refund method/timeline and delivery promise against the real supplier agreements, then update the pages. Have the wording reviewed by a professional before launch.',
    blocks: ['LAUNCH'],
    needsProfessionalAdvice: true,
  });

  // --- Automation posture --------------------------------------------------
  items.push({
    id: 'auto-publish',
    label: 'Automatic product publishing',
    status: automation.autoPublishEligible ? 'OWNER_DECISION' : 'PASS',
    detail: automation.autoPublishEligible
      ? 'Auto-publish is ENABLED: eligible supplier items can go live without a human decision.'
      : 'Auto-publish is OFF (safe default): eligible items are imported as drafts for human approval.',
    ownerAction: automation.autoPublishEligible
      ? 'Confirm this is intentional. Every publish is audited, but nothing else gates the customer-visible result.'
      : '',
    blocks: automation.autoPublishEligible ? ['LAUNCH'] : [],
  });

  items.push({
    id: 'supplier-live-ordering',
    label: 'Live supplier ordering',
    status: automation.supplierLiveOrderingEnabled ? 'OWNER_DECISION' : 'PASS',
    detail: automation.supplierLiveOrderingEnabled
      ? 'Live supplier ordering is ENABLED — real supplier orders can be placed.'
      : 'Live supplier ordering is OFF, so no real purchase order is sent to a supplier.',
    ownerAction: automation.supplierLiveOrderingEnabled
      ? 'Confirm supplier account, pricing and returns terms are signed before accepting real customer orders.'
      : '',
    blocks: [],
  });

  items.push(
    automation.cronSecretConfigured
      ? {
          id: 'cron-secret',
          label: 'Scheduled jobs authenticated',
          status: 'PASS',
          detail: 'CRON_SECRET is set, so the job endpoint rejects unauthenticated callers.',
          ownerAction: '',
          blocks: [],
        }
      : {
          id: 'cron-secret',
          label: 'Scheduled jobs authenticated',
          status: 'NOT_CONFIGURED',
          detail: 'CRON_SECRET is missing: the housekeeping/job endpoint cannot be safely triggered, so queued work will not drain on a schedule.',
          ownerAction: 'Generate a long random CRON_SECRET, set it in the deployment environment and in the scheduler configuration.',
          blocks: ['LAUNCH'],
        }
  );

  // --- Catalogue -----------------------------------------------------------
  const active = catalog.productCounts.ACTIVE ?? 0;
  items.push(
    active > 0
      ? {
          id: 'catalogue',
          label: 'Sellable catalogue',
          status: 'PASS',
          detail: `${active} product(s) are published.`,
          ownerAction: '',
          blocks: [],
        }
      : {
          id: 'catalogue',
          label: 'Sellable catalogue',
          status: 'ACTION_REQUIRED',
          detail: 'No product is published, so there is nothing a customer could buy.',
          ownerAction: 'Import or create products, verify supplier stock and cost, then publish deliberately (publishing requires owner approval).',
          blocks: ['DEMO', 'LAUNCH'],
        }
  );

  // --- AI provider ---------------------------------------------------------
  items.push(
    automation.aiProviderConfigured
      ? {
          id: 'ai-provider',
          label: 'AI narrative provider',
          status: 'PASS',
          detail: 'A model provider is configured. Narrative output is always labelled unverified and never replaces a computed figure.',
          ownerAction: '',
          blocks: [],
        }
      : {
          id: 'ai-provider',
          label: 'AI narrative provider',
          status: 'NOT_CONFIGURED',
          detail:
            'No model provider is configured, so the AI CEO runs in deterministic mode: every finding, metric and recommendation is computed from database records with no model involved.',
          ownerAction: 'Optional: configure a provider (AI_PROVIDER / AI_API_KEY / AI_MODEL) if you want a written narrative on top of the deterministic report.',
          blocks: [],
        }
  );

  items.push(
    snapshot.store.demoMode
      ? {
          id: 'demo-mode',
          label: 'Demo mode',
          status: 'OWNER_DECISION',
          detail: 'Demo mode is ON, which labels the storefront as a demonstration.',
          ownerAction: 'Turn demo mode off only after real products, policies and payments are ready.',
          blocks: ['LAUNCH'],
        }
      : {
          id: 'demo-mode',
          label: 'Demo mode',
          status: 'PASS',
          detail: 'Demo mode is off.',
          ownerAction: '',
          blocks: [],
        }
  );

  return items;
}

export function readinessBlockers(items: ReadinessItem[], stage: 'TESTING' | 'DEMO' | 'LAUNCH'): ReadinessItem[] {
  return items.filter(
    (item) =>
      item.blocks.includes(stage) &&
      (item.status === 'NOT_CONFIGURED' || item.status === 'ACTION_REQUIRED' || item.status === 'OWNER_DECISION')
  );
}
