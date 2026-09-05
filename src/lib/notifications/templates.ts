import type { NotificationTemplate } from '@prisma/client';

/**
 * Email templates. Plain, dependency-free HTML (inline styles, table layout)
 * so they render correctly across email clients including Gmail on Android.
 *
 * All variables are pre-rendered strings provided by the caller - templates
 * never touch the database and never contain demo/fake content: they only
 * echo real order data passed in.
 */

export interface TemplateContext {
  storeName: string;
  supportEmail: string;
  appUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export type TemplateVars = Record<string, string>;

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout(
  ctx: TemplateContext,
  title: string,
  bodyHtml: string,
  cta?: { label: string; url: string }
): string {
  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="background:#20573c;padding:20px 24px;">
          <span style="color:#ffffff;font-size:18px;font-weight:bold;">${escapeHtml(ctx.storeName)}</span>
        </td></tr>
        <tr><td style="padding:24px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#111827;">${escapeHtml(title)}</h1>
          ${bodyHtml}
          ${
            cta
              ? `<p style="margin:20px 0;"><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#35885d;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;">${escapeHtml(cta.label)}</a></p>`
              : ''
          }
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">
          You are receiving this email because of activity on your ${escapeHtml(ctx.storeName)} account or order.<br/>
          Need help? Contact <a href="mailto:${escapeHtml(ctx.supportEmail)}" style="color:#35885d;">${escapeHtml(ctx.supportEmail)}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 12px;color:#374151;font-size:14px;line-height:1.5;">${text}</p>`;
}

type TemplateFn = (vars: TemplateVars, ctx: TemplateContext) => RenderedEmail;

export const templates: Record<NotificationTemplate, TemplateFn> = {
  WELCOME: (vars, ctx) => ({
    subject: `Welcome to ${ctx.storeName}, ${vars.name}!`,
    html: layout(
      ctx,
      `Welcome, ${escapeHtml(vars.name)}!`,
      p('Your account has been created successfully. You can now:') +
        `<ul style="color:#374151;font-size:14px;line-height:1.6;">
           <li>Track your orders any time</li>
           <li>Save delivery addresses for faster checkout</li>
           <li>Request returns or refunds where eligible</li>
         </ul>`,
      { label: 'Visit your account', url: `${ctx.appUrl}/account` }
    ),
    text: `Welcome to ${ctx.storeName}, ${vars.name}! Your account is ready: ${ctx.appUrl}/account`,
  }),

  PASSWORD_RESET: (vars, ctx) => ({
    subject: `Reset your ${ctx.storeName} password`,
    html: layout(
      ctx,
      'Password reset requested',
      p(`Hi ${escapeHtml(vars.name)}, we received a request to reset your password.`) +
        p(
          'This link is valid for a limited time. If you did not request this, you can safely ignore this email - your password will not change.'
        ),
      { label: 'Choose a new password', url: vars.resetUrl }
    ),
    text: `Reset your password: ${vars.resetUrl}\nIf you did not request this, ignore this email.`,
  }),

  ORDER_CONFIRMATION: (vars, ctx) => ({
    subject: `Order ${vars.orderNumber} confirmed - ${ctx.storeName}`,
    html: layout(
      ctx,
      'Thank you! Your order is confirmed.',
      p(
        `Hi ${escapeHtml(vars.customerName)}, we have received your order <strong>${escapeHtml(vars.orderNumber)}</strong> (${escapeHtml(vars.paymentMethod)}).`
      ) +
        `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin:12px 0;">${vars.linesHtml}</div>` +
        `<p style="font-size:14px;color:#111827;"><strong>Total paid/payable: ${escapeHtml(vars.total)}</strong></p>` +
        p(`Delivering to:<br/>${vars.addressHtml}`) +
        p(`Estimated delivery: ${escapeHtml(vars.estimatedDelivery)}.`),
      { label: 'View / track your order', url: vars.trackUrl }
    ),
    text: `Order ${vars.orderNumber} confirmed.\n${vars.itemsSummary}\nTotal: ${vars.total}\nTrack: ${vars.trackUrl}`,
  }),

  PAYMENT_FAILED: (vars, ctx) => ({
    subject: `Payment failed for order ${vars.orderNumber}`,
    html: layout(
      ctx,
      'We could not process your payment',
      p(
        `Hi ${escapeHtml(vars.customerName)}, the payment for order <strong>${escapeHtml(vars.orderNumber)}</strong> (${escapeHtml(vars.total)}) did not go through.`
      ) +
        p(
          'No money has been captured. You can retry the payment safely - your order is reserved for a short while.'
        ),
      { label: 'Retry payment', url: vars.retryUrl }
    ),
    text: `Payment failed for order ${vars.orderNumber}. Retry: ${vars.retryUrl}`,
  }),

  ORDER_PROCESSING: (vars, ctx) => ({
    subject: `Order ${vars.orderNumber} is being processed`,
    html: layout(
      ctx,
      'Your order is being prepared',
      p(
        `Hi ${escapeHtml(vars.customerName)}, your order <strong>${escapeHtml(vars.orderNumber)}</strong> has been sent for fulfilment. We will email you the tracking details as soon as it ships.`
      ),
      { label: 'Track your order', url: vars.trackUrl }
    ),
    text: `Order ${vars.orderNumber} is being processed. Track: ${vars.trackUrl}`,
  }),

  ORDER_SHIPPED: (vars, ctx) => ({
    subject: `Order ${vars.orderNumber} has shipped!`,
    html: layout(
      ctx,
      'Your order is on the way',
      p(
        `Hi ${escapeHtml(vars.customerName)}, good news - order <strong>${escapeHtml(vars.orderNumber)}</strong> has shipped.`
      ) +
        (vars.trackingNumber
          ? p(
              `Carrier: <strong>${escapeHtml(vars.carrier || '—')}</strong><br/>Tracking number: <strong>${escapeHtml(vars.trackingNumber)}</strong>`
            )
          : p('Tracking details will be updated on your order page.')),
      { label: 'Track shipment', url: vars.trackUrl }
    ),
    text: `Order ${vars.orderNumber} shipped. Tracking: ${vars.trackingNumber || 'see order page'} - ${vars.trackUrl}`,
  }),

  ORDER_DELIVERED: (vars, ctx) => ({
    subject: `Order ${vars.orderNumber} delivered`,
    html: layout(
      ctx,
      'Your order has been delivered',
      p(
        `Hi ${escapeHtml(vars.customerName)}, order <strong>${escapeHtml(vars.orderNumber)}</strong> was delivered. We hope you love it!`
      ) +
        p(
          `If something is wrong, you can request a return within ${escapeHtml(vars.returnWindowDays)} days of delivery.`
        ),
      { label: 'View order details', url: vars.orderUrl }
    ),
    text: `Order ${vars.orderNumber} delivered. Return window: ${vars.returnWindowDays} days. ${vars.orderUrl}`,
  }),

  ORDER_CANCELLED: (vars, ctx) => ({
    subject: `Order ${vars.orderNumber} cancelled`,
    html: layout(
      ctx,
      'Your order was cancelled',
      p(
        `Hi ${escapeHtml(vars.customerName)}, order <strong>${escapeHtml(vars.orderNumber)}</strong> has been cancelled.`
      ) +
        p(`Reason: ${escapeHtml(vars.reason)}`) +
        (vars.refundNote ? p(escapeHtml(vars.refundNote)) : ''),
      { label: 'View your orders', url: `${ctx.appUrl}/account/orders` }
    ),
    text: `Order ${vars.orderNumber} cancelled. Reason: ${vars.reason}. ${vars.refundNote ?? ''}`,
  }),

  REFUND_INITIATED: (vars, ctx) => ({
    subject: `Refund initiated for order ${vars.orderNumber}`,
    html: layout(
      ctx,
      'Your refund has been initiated',
      p(
        `Hi ${escapeHtml(vars.customerName)}, we have initiated a refund of <strong>${escapeHtml(vars.refundAmount)}</strong> for order <strong>${escapeHtml(vars.orderNumber)}</strong>.`
      ) +
        p(
          'Refunds typically reflect as per your bank/payment provider timelines after the gateway processes them.'
        ),
      { label: 'View order', url: vars.orderUrl }
    ),
    text: `Refund of ${vars.refundAmount} initiated for order ${vars.orderNumber}.`,
  }),

  REFUND_COMPLETED: (vars, ctx) => ({
    subject: `Refund completed for order ${vars.orderNumber}`,
    html: layout(
      ctx,
      'Refund completed',
      p(
        `Hi ${escapeHtml(vars.customerName)}, your refund of <strong>${escapeHtml(vars.refundAmount)}</strong> for order <strong>${escapeHtml(vars.orderNumber)}</strong> has been processed by the payment gateway.`
      ) + p('Depending on your bank, it may take a few business days to appear in your account.'),
      { label: 'View order', url: vars.orderUrl }
    ),
    text: `Refund of ${vars.refundAmount} completed for order ${vars.orderNumber}.`,
  }),

  RETURN_UPDATE: (vars, ctx) => ({
    subject: `Return update for order ${vars.orderNumber}`,
    html: layout(
      ctx,
      `Return ${escapeHtml(vars.returnStatus)}`,
      p(
        `Hi ${escapeHtml(vars.customerName)}, your return request for order <strong>${escapeHtml(vars.orderNumber)}</strong> is now: <strong>${escapeHtml(vars.returnStatus)}</strong>.`
      ) + (vars.note ? p(escapeHtml(vars.note)) : ''),
      { label: 'View order', url: vars.orderUrl }
    ),
    text: `Return for order ${vars.orderNumber}: ${vars.returnStatus}. ${vars.note ?? ''}`,
  }),

  FULFILMENT_FAILED_ADMIN: (vars, ctx) => ({
    subject: `[ACTION REQUIRED] Fulfilment failed for ${vars.orderNumber}`,
    html: layout(
      ctx,
      'Supplier fulfilment failed',
      p(
        `Order <strong>${escapeHtml(vars.orderNumber)}</strong> could not be fulfilled by <strong>${escapeHtml(vars.supplier)}</strong>.`
      ) +
        p(`Error: ${escapeHtml(vars.error)}`) +
        p('Open the order to retry fulfilment or start a customer refund.'),
      { label: 'Open order in admin', url: vars.adminUrl }
    ),
    text: `Fulfilment failed for ${vars.orderNumber} (supplier ${vars.supplier}): ${vars.error}. ${vars.adminUrl}`,
  }),

  CONTACT_MESSAGE_ADMIN: (vars, ctx) => ({
    subject: `New contact message: ${vars.subject || '(no subject)'}`,
    html: layout(
      ctx,
      'New contact form message',
      p(`<strong>From:</strong> ${escapeHtml(vars.name)} &lt;${escapeHtml(vars.email)}&gt;`) +
        p(`<strong>Message:</strong><br/>${escapeHtml(vars.message).replace(/\n/g, '<br/>')}`),
      { label: 'Open admin inbox', url: vars.adminUrl }
    ),
    text: `New message from ${vars.name} <${vars.email}>: ${vars.message}`,
  }),
};

export function renderTemplate(
  template: NotificationTemplate,
  vars: TemplateVars,
  ctx: TemplateContext
): RenderedEmail {
  const fn = templates[template];
  if (!fn) throw new Error(`Unknown notification template: ${template}`);
  return fn(vars, ctx);
}
