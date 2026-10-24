export function payableReference(reference: string | undefined, id: string): string {
  const value = reference?.trim();
  return value && value !== id ? value : `AP-${id.slice(0, 8).toUpperCase()}`;
}
export function payableRawReference(reference: string | undefined, id: string): string {
  return reference === id ? '' : reference ?? '';
}
export function payableDate(value: string | null | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : 'غير محدد';
}
