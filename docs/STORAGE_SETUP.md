# Durable product-image storage

Status: **implementation and mocked/isolated tests only**. This document does not assert that a real Cloudinary/S3 account, public URL, or Production upload has been configured or executed. Production configuration and Production product changes require separate owner approval.

## Behavior enforced by the application

- `local` is for development/test only. It is ephemeral on Vercel and is refused when `NODE_ENV=production`.
- `s3` and `cloudinary` are durable providers. Missing/invalid configuration returns **503 `STORAGE_NOT_CONFIGURED`**; there is **no local-disk fallback**.
- Uploads require an admin session, CSRF, rate limiting, a supported image signature, and a maximum size of 5 MB. Original filenames are discarded.
- A successful upload returns a URL and provider key. Saving the product persists that URL in `ProductImage.url`.
- S3/Cloudinary hosts are added to the responsive Next.js image optimizer allow-list at build time. Redeploy after changing storage/public hosts.
- Delete is limited to app-managed `p-<timestamp>-<random>` keys. Supplier/seed/arbitrary account objects are refused.
- An image referenced by any product returns **409** and is not deleted. Detach it from every product first. Cloudinary deletion requires the exact returned `public_id`, not a transformation URL.
- Provider non-2xx responses, invalid returned URLs/IDs, timeouts (20 seconds), and unconfirmed Cloudinary deletes fail the operation; no success URL is returned.

## Option A — Cloudinary (simplest from an Android phone)

Use the owner’s Cloudinary account. Chrome on Android is sufficient; no SDK or terminal is needed.

1. In Cloudinary → **Dashboard / API Keys**, note the **Cloud name**, **API Key**, and **API Secret**. Do not paste them into chat, product descriptions, screenshots, Git, or `NEXT_PUBLIC_*` variables.
2. In a second browser tab open Vercel → `zenvora-store` → **Settings → Environment Variables**.
3. Start with **Preview only**. Add:

   | Name                    | Preview example       | Secret?                  |
   | ----------------------- | --------------------- | ------------------------ |
   | `STORAGE_PROVIDER`      | `cloudinary`          | No                       |
   | `CLOUDINARY_CLOUD_NAME` | value from Cloudinary | No                       |
   | `CLOUDINARY_API_KEY`    | value from Cloudinary | Yes — treat as sensitive |
   | `CLOUDINARY_API_SECRET` | value from Cloudinary | **Yes**                  |
   | `CLOUDINARY_FOLDER`     | `zenvora-preview`     | No                       |

   Use a separate folder such as `zenvora-production` later so Preview cleanup cannot touch Production objects.

4. Save, then create/redeploy the **Preview** deployment through the approved review flow. Environment changes do not retroactively change an already-running deployment.
5. In the isolated Preview admin, create a **draft test product** (not a Production product). Upload a small image and save the draft.
6. Verify all of the following before calling it configured:
   - response/provider is Cloudinary and `persistent:true`;
   - the saved `ProductImage.url` is an `https://res.cloudinary.com/...` URL containing the Preview folder;
   - reopening the draft displays the image at mobile width and desktop width;
   - the image still resolves after another Preview deployment;
   - Cloudinary Media Library shows the expected object in the Preview folder;
   - deleting while attached returns 409; after detaching, deletion using the exact returned key succeeds.
7. Record the Preview deployment ID, tester/date, folder, and result. Do not infer success merely because environment-variable names exist.

Production requires a separate approval: add the Production-scoped variables with the Production folder, deploy the reviewed commit, and perform an owner-approved draft/upload check. Do not alter the published product or stock for the test.

## Option B — Cloudflare R2 / S3-compatible storage

### Cloudflare R2

1. Create a dedicated bucket. Configure a public development URL or custom domain for reads; never grant public write access.
2. Create an R2 API token scoped to **Object Read & Write for this bucket only**. Keep the secret in Vercel, not chat/Git.
3. Set Preview variables:

   | Name                   | Value shape                                                                   |
   | ---------------------- | ----------------------------------------------------------------------------- |
   | `STORAGE_PROVIDER`     | `s3`                                                                          |
   | `S3_BUCKET`            | exact bucket name                                                             |
   | `S3_REGION`            | `auto` for R2                                                                 |
   | `S3_ENDPOINT`          | `https://<account-id>.r2.cloudflarestorage.com` — origin only, no bucket/path |
   | `S3_PUBLIC_BASE_URL`   | public HTTPS bucket/custom-domain base, without a trailing object key         |
   | `S3_ACCESS_KEY_ID`     | token access key ID                                                           |
   | `S3_SECRET_ACCESS_KEY` | token secret                                                                  |

The application signs path-style API requests to `<endpoint>/<bucket>/uploads/<filename>` and stores `<S3_PUBLIC_BASE_URL>/uploads/<filename>`. `S3_PUBLIC_BASE_URL` is mandatory with a custom endpoint; an API endpoint is not assumed to be publicly readable.

### AWS S3

Set `STORAGE_PROVIDER=s3`, bucket, region, access key ID, and secret. Leave `S3_ENDPOINT` unset for AWS virtual-hosted requests. The default public URL is `https://<bucket>.s3.<region>.amazonaws.com`; set `S3_PUBLIC_BASE_URL` when using a CDN/custom domain. Configure only the required public-read/CDN behavior and scope the IAM credential to the bucket’s `uploads/*` objects where practical.

### MinIO/other S3-compatible services

Use an API origin in `S3_ENDPOINT`, the service’s region, and an explicit public HTTPS base. Production API endpoints must use HTTPS. Public hostnames with credentials, IP literals, local/private names, query strings, or fragments are rejected for stored media URLs.

## Isolated verification without touching a real cloud account

The repository tests mock every S3/Cloudinary network response. They cover signing, R2 path-style requests, public URLs, non-2xx failures, timeouts being attached to requests, unsafe keys, delete confirmation, and fail-closed provider selection. Admin multipart HTTP E2E uses only CI’s local disk and throw-away PostgreSQL database.

Run in the approved CI/development environment:

```bash
npx vitest run tests/unit/storage-providers.test.ts tests/unit/launch-readiness.test.ts tests/unit/image-remote-hosts.test.ts
npm run test:e2e -- tests/e2e/admin-uploads.test.ts
```

A green mocked test proves application behavior, **not** cloud credentials, public bucket policy, network reachability, object durability, or mobile rendering. Those require the explicit Preview checks above.

## Existing images and rotation

- Changing providers does not copy old local files or rewrite existing database rows. Supplier-CDN URLs remain supplier URLs and are not proof of admin-upload durability.
- Inventory existing product images first. Re-upload any needed local/admin-managed image to durable storage and save its new URL through the approved product-edit flow. Do not run a Production data rewrite without a reviewed backup and separate approval.
- Rotate credentials if they were exposed. Update Preview first, verify, then seek approval for Production rotation. Remove old credentials only after the new deployment is verified.
- Keep credentials server-only. `CLOUDINARY_API_SECRET`, `S3_SECRET_ACCESS_KEY`, and access IDs are never sent to the browser by the upload implementation.
