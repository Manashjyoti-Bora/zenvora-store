/**
 * Job-level error taxonomy.
 *
 * - PermanentJobError: retrying cannot succeed (supplier out of stock,
 *   unsupported operation, rejected order). The runner fails the job
 *   immediately and triggers the domain failure handler (e.g. mark order
 *   FULFILMENT_FAILED + alert admin).
 * - Any other error: transient (network timeout, 5xx). The runner retries
 *   with exponential backoff + jitter until maxAttempts.
 */
export class PermanentJobError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PermanentJobError';
  }
}
