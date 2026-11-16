import { z } from 'zod';
import { MODULES } from './catalog';

export const moduleKeys = MODULES.map(m => m.key);
export const moduleKey = z.string().refine(key => moduleKeys.includes(key as typeof moduleKeys[number]));
const amount = z.number().finite().min(0).max(100000000).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < .000001);
export const moduleInput = z.object({
  key: moduleKey, revision: z.number().int().positive(),
  name_ar: z.string().trim().min(2).max(120), name_en: z.string().trim().min(2).max(120),
  description_ar: z.string().trim().min(2).max(500), description_en: z.string().trim().min(2).max(500),
  icon: z.enum(['chart','finance','bank','calendar','regulatory','organization','opening']),
  pricing: z.enum(['fixed','quote']), monthly: amount.nullable(), yearly: amount.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/), published: z.boolean(),
  requires: z.array(moduleKey).max(7), reason: z.string().trim().min(5).max(1000),
}).strict().refine(m => m.pricing === 'quote' || (m.monthly !== null && m.yearly !== null));
export type BundleModule = Omit<z.infer<typeof moduleInput>, 'reason'>;
export type BundleRequest = {
  id: string; organization_id: string; organization_name?: string; request_number: number;
  status: 'pending'|'offered'|'accepted'|'activated'|'rejected'|'cancelled'; revision: number;
  items: BundleModule[]; billing_interval: 'monthly'|'yearly'; currency: string;
  total: number|null; max_users: number; phone: string; notes: string; reason: string|null;
  created_at: string;
};
export function bundleSelection(modules: BundleModule[], keys: string[], interval: 'monthly'|'yearly') {
  const selected = new Set(keys);
  for (const key of ['assets','liquidity']) selected.add(key);
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of modules) if (selected.has(m.key)) for (const key of m.requires) {
      if (!selected.has(key)) {selected.add(key); changed = true;}
    }
  }
  const items = modules.filter(m => selected.has(m.key));
  const unavailable = [...selected].some(key => !items.some(m => m.key === key && m.published));
  const currencies = new Set(items.map(m => m.currency));
  const quote = items.some(m => m.pricing === 'quote' || m[interval] == null);
  return {items, unavailable, mixedCurrency: currencies.size > 1, currency: items[0]?.currency ?? 'SAR',
    total: quote ? null : items.reduce((sum,m) => sum + Math.round(Number(m[interval]) * 100),0) / 100};
}
export function bundleStatus(status: BundleRequest['status'], ar: boolean) {
  return ({pending:['بانتظار عرض السعر','Awaiting quote'],offered:['عرض سعر للمراجعة','Quote ready'],accepted:['بانتظار التفعيل','Awaiting activation'],activated:['مفعّل','Activated'],rejected:['مرفوض','Rejected'],cancelled:['ملغى','Cancelled']} as const)[status][ar?0:1];
}
export function bundleError(code: string, ar: boolean) {
  if (/CONFLICT/.test(code)) return ar?'تغيرت البيانات أو يوجد طلب مفتوح. حدّث الصفحة وراجع الطلب قبل المحاولة.':'Details changed or a request is open. Refresh and review before retrying.';
  if (/CURRENCY/.test(code)) return ar?'يجب توحيد عملة الموديولات المختارة لدى الإدارة.':'Administration must align the selected modules’ currency.';
  if (/UNAVAILABLE|DEPENDENCY/.test(code)) return ar?'أحد الموديولات المطلوبة غير منشور أو له متطلبات غير متاحة.':'A selected module or dependency is unavailable.';
  return ar?'تعذر إتمام الإجراء. تحقق من البيانات والصلاحيات وأعد المحاولة.':'Unable to complete the action. Check details and permissions and retry.';
}
