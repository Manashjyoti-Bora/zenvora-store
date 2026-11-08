# Preview and recoverability verification

This document separates repository/CI evidence from real external operation. A READY deployment, a present environment-variable **name**, or a mocked test is not proof that the external service works.

## Evidence snapshot

| Item                              | Evidence                                                                                                                                                                           | Status                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Current application-code Preview  | Vercel deployment `dpl_45TJEkZaXrLipPPv8Gpn9j6c978m`, READY/STAGED, commit `4b76228e1945ba5864f81cb8c2c325a7bdff7868`, PR #23                                                      | COMPLETE for metadata only                                                   |
| Prior durable-storage Preview     | `dpl_8YmN9A7yofPcyTKDeQ5JXqSTht1a`, READY/STAGED, commit `8e47ae6342354d253b9988a78a69bd2d200a0c68`                                                                                | COMPLETE for prior metadata only                                             |
| Preserved Production/rollback     | `dpl_HYvTGhsQyyE2DU9vGNETh5Yq2NBq`, READY/PROMOTED, commit `149f3408da0dd140a66208777127a3af45440808`, still listed first for Production and `isRollbackCandidate:true`            | COMPLETE for preservation metadata; no deployment mutation performed         |
| Preview storage configuration     | Exact deployment env-name list contains no `STORAGE_PROVIDER`, Cloudinary, or S3 variable names. No values were decrypted.                                                         | **BLOCKED** for real-provider verification                                   |
| Preview application HTTP          | A fresh `4b76228`-specific `/api/health` URL on `dpl_45TJEkZaXrLipPPv8Gpn9j6c978m` redirected to authenticated Vercel deployment protection/SSO; no application JSON was returned. | **NOT VERIFIED**                                                             |
| Preview email                     | SMTP-related names in deployment metadata do not reveal valid values, sender verification, handoff, or inbox receipt.                                                              | **NOT VERIFIED**                                                             |
| Preview scheduler                 | Deployment metadata declares `/api/cron/jobs` at `17 0 * * *` (daily). No actual scheduled-run result was available.                                                               | **PARTIAL**: schedule exists; timely operation and outcomes **NOT VERIFIED** |
| Neon backup/PITR/restore          | No Neon console/connector evidence or isolated restore result was available.                                                                                                       | **BLOCKED / NOT VERIFIED**                                                   |
| Android Chrome and real mobile UX | No real-device result was available.                                                                                                                                               | **NOT VERIFIED**                                                             |

Commit-specific CI/Preview results and the phase verdict are in [`LAUNCH_EVIDENCE.md`](./LAUNCH_EVIDENCE.md); do not reuse the baseline Preview SHA as evidence for later code.

## Real Cloudinary gate

Follow [`STORAGE_SETUP.md`](./STORAGE_SETUP.md) with Preview-only owner configuration and synthetic data. Required evidence for every run:

- Preview deployment ID, commit SHA, and verification time.
- Draft product ID and uploaded managed key/public URL (no secrets).
- Successful admin upload and public HTTPS response.
- Continued public access after a **different Preview redeployment**, proving bytes are not ephemeral local files.
- Responsive optimizer URLs/srcset and successful AVIF/WebP responses where supported; mobile and desktop viewport checks.
- Attached-image deletion rejected with HTTP 409 and the remote object still present.
- Detached managed upload deleted successfully, with public object subsequently absent; no external/unmanaged URL deletion.
- Android Chrome device/browser version and rendering result. Desktop emulation alone is not Android evidence.

Until those records exist, storage is **BLOCKED**, not COMPLETE. Existing images are not automatically migrated.

## Worker gate

The declared Vercel Hobby cron is daily and is too sparse for timely notification/webhook/supplier queues. The existing deployment runbook recommends an authenticated external scheduler every five minutes (or an appropriate plan change). Do not silently increase Production scheduling or expose the cron secret.

For each Preview verification run, record:

1. Scheduler/provider, Preview deployment ID, path, intended cadence, and non-secret run ID/time.
2. Anonymous request returns 401; authorized scheduler request is made only by the approved scheduler.
3. HTTP status plus response counters: `claimed`, `succeeded`, `failed`, `retried`, `rescheduled`.
4. Job IDs/types/statuses for every nonzero failure/retry outcome. A 200 response means the endpoint ran; `claimed:0` is a no-op, not delivery.
5. For a synthetic owner-controlled notification, persisted notification status/provider plus actual inbox evidence. Console `SENT` is only a console handoff.
6. Retry success on a deliberately isolated transient failure and terminal failure for missing SMTP. Never point this test at a customer address.

Isolated integration tests cover application state transitions; they do not prove Vercel invokes the schedule or that an inbox accepts mail.

## Neon backup/PITR and isolated restore gate

No Production mutation is authorized by this runbook. The owner/database operator must use the Neon console and record the actual current plan and retention/restore capability—do not assume a retention window from old documentation.

Required evidence:

1. Neon project ID, Production branch ID, plan, configured/available PITR window, and observation time. Do not include connection strings or passwords.
2. Choose a recovery point and restore it to a **new isolated branch**. Do not overwrite the Production branch and do not point any deployed application at the restored branch.
3. Record target branch ID, recovery timestamp, operation start/end, and success/failure result.
4. Using owner-controlled private access, perform read-only checks: expected schema/migration markers and non-sensitive aggregate counts. Do not paste customer rows, addresses, payment details, or other PII into evidence.
5. Confirm the existing Production branch/deployment was untouched. Delete only the temporary restore branch after owner review and record deletion; retain the original Production rollback deployment.
6. State any measured recovery time and remaining limitations. A dashboard statement that PITR exists without a restore result remains **NOT VERIFIED**.

No backup retention, PITR capability, restore success, or recovery time is asserted in this repository until this evidence is supplied.
