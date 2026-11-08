/**
 * RFC 2606 example domains are placeholders, never real support mailboxes.
 * Pure module: safe for launch-readiness checks without loading env/Prisma.
 */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return true;
  return /@(?:[a-z0-9-]+\.)*example\.(?:com|net|org)$/i.test(email.trim());
}
