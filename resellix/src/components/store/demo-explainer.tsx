import { Alert } from '@/components/ui/feedback';

/**
 * Shown on the home page and FAQ while settings.demoMode is true.
 * Keeps the demo/production boundary unmistakable.
 */
export function DemoExplainer() {
  return (
    <Alert tone="warning" title="This store is running in demo mode">
      <ul className="mt-1 list-disc space-y-1 pl-4 text-xs sm:text-sm">
        <li>Products shown are sample catalog entries for evaluating the platform.</li>
        <li>
          Payments (when enabled) run through a clearly-labelled TEST provider — no real money
          moves.
        </li>
        <li>Orders placed here are not fulfilled or shipped.</li>
        <li>
          The owner can switch off demo mode in <strong>Admin → Settings</strong> once real
          products, payment credentials and shipping arrangements are configured (see
          SETUP_CHECKLIST.md).
        </li>
      </ul>
    </Alert>
  );
}
