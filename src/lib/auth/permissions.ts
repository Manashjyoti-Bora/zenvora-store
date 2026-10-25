import type { SessionUser } from './session';

/**
 * Permission levels (0–4) layered over the existing Role enum. Levels are a
 * READ model for the operations dashboard and for future fine-grained guards;
 * they never widen what a role can already do:
 *
 *   0  ANONYMOUS   browse, track with order number + e-mail
 *   1  CUSTOMER    own cart / orders / addresses
 *   2  OBSERVER    STAFF — read operations dashboards, logs, reports
 *   3  OPERATOR    STAFF — run supplier syncs, dry runs, bulk import as DRAFT,
 *                  decide returns/cancellations (never publish, never money)
 *   4  OWNER       ADMIN — publish, settings, payments, users, secrets, deploys
 *
 * Today the admin area is ADMIN-only (see src/app/admin/layout.tsx), so STAFF
 * effectively sits at level 2 only for API routes that call requireStaff().
 * Automation (cron, AI helpers, job runner) acts at most as level 3 and can
 * never grant itself level 4 — see docs/AUTONOMOUS_OPERATIONS.md.
 */
export type PermissionLevel = 0 | 1 | 2 | 3 | 4;

export const PERMISSION_LEVEL_LABELS: Record<PermissionLevel, string> = {
  0: 'Anonymous',
  1: 'Customer',
  2: 'Observer (staff, read-only)',
  3: 'Operator (staff, non-publishing actions)',
  4: 'Owner / Admin',
};

export type OperationAction =
  | 'ops.dashboard.read'
  | 'ops.logs.read'
  | 'supplier.sync.run'
  | 'supplier.dryrun.run'
  | 'supplier.import.draft'
  | 'catalog.publish'
  | 'settings.write'
  | 'payments.manage'
  | 'users.manage'
  | 'ai.configure';

/** Minimum level for each operation. Publishing and money are always level 4. */
export const ACTION_MIN_LEVEL: Record<OperationAction, PermissionLevel> = {
  'ops.dashboard.read': 2,
  'ops.logs.read': 2,
  'supplier.sync.run': 3,
  'supplier.dryrun.run': 3,
  'supplier.import.draft': 3,
  'catalog.publish': 4,
  'settings.write': 4,
  'payments.manage': 4,
  'users.manage': 4,
  'ai.configure': 4,
};

export function permissionLevelOf(user: Pick<SessionUser, 'role' | 'status'> | null | undefined): PermissionLevel {
  if (!user || user.status !== 'ACTIVE') return 0;
  switch (user.role) {
    case 'ADMIN':
      return 4;
    case 'STAFF':
      return 3;
    case 'CUSTOMER':
    default:
      return 1;
  }
}

export function canPerform(
  user: Pick<SessionUser, 'role' | 'status'> | null | undefined,
  action: OperationAction
): boolean {
  return permissionLevelOf(user) >= ACTION_MIN_LEVEL[action];
}

/** Level at which unattended automation runs; it must never reach 4. */
export const AUTOMATION_MAX_LEVEL: PermissionLevel = 3;
