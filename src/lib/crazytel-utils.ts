export function buildCrazytelOutboundTarget(template: string, destinationPhone: string): string | null {
  if (!template.includes("{number}")) return null;
  const digits = destinationPhone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  const target = template.replaceAll("{number}", digits);
  return target.startsWith("sip:") && !/[\s<>]/.test(target) ? target : null;
}
