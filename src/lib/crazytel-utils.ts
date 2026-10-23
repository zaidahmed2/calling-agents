export const CRAZYTEL_OUTBOUND_URI_TEMPLATE = "sip:{number}@hybrid.sip.crazytel.net.au";

export function normalizeCrazytelSipUsername(value: string): string | null {
  const normalized = value.trim();
  const match = /^(?:sip:)?([A-Za-z0-9._+-]{1,120})(?:@hybrid\.sip\.crazytel\.net\.au)?$/i.exec(normalized);
  return match?.[1] ?? null;
}

export function buildCrazytelOutboundTarget(template: string, destinationPhone: string): string | null {
  if (!template.includes("{number}")) return null;
  let digits = destinationPhone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `61${digits.slice(1)}`;
  if (digits.length < 8 || digits.length > 15) return null;
  const target = template.replaceAll("{number}", digits);
  return target.startsWith("sip:") && !/[\s<>]/.test(target) ? target : null;
}

export function buildCrazytelCallerIdHeaders(callerId: string | null | undefined): string[] {
  if (!callerId) return [];
  const digits = callerId.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return [];
  return [
    `Remote-Party-ID: ${digits}`,
    `P-Asserted-Identity: ${digits}`,
  ];
}
