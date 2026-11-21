import {z} from 'zod';

const positive = z.number().finite().positive().lt(1e16);
export const personalSaleCorrectionSchema = z.object({
  action: z.literal('correct-sale'),
  request_id: z.string().uuid(),
  asset_account_id: z.string().uuid(),
  proceeds_account_id: z.string().uuid(),
  transaction_date: z.string().date(),
  quantity: positive,
  unit_price: positive,
  fx_rate: positive,
  notes: z.string().max(2000),
  reason: z.string().trim().min(5).max(500),
}).strict();

export function isPersonalSaleCorrectionCandidate(row: any, userId: string) {
  const metadata = row?.metadata;
  return Boolean(row?.transaction_type === 'SALE' && row.user_id === userId &&
    !row.organization_id && !row.asset_accounts?.organization_id &&
    row.asset_accounts?.ownership_scope !== 'ORGANIZATION' &&
    row.transfer_id && metadata?.proceeds_account_id && !metadata.asset_deleted &&
    !metadata.sale_correction_replacement_id && !metadata.investment_id &&
    !metadata.financial_event_id && !metadata.personal_contract_id &&
    !row.reversal_of_transaction_id);
}

const messages: Record<string, [string, string]> = {
  SALE_CORRECTION_INVALID: ['تحقق من التاريخ والكمية والسعر وسعر الصرف وسبب التصحيح.', 'Check the date, quantity, price, exchange rate and correction reason.'],
  SALE_CORRECTION_NOT_AVAILABLE: ['هذا السند غير مؤهل لتصحيح البيع الشخصي.', 'This voucher is ineligible for personal sale correction.'],
  SALE_CORRECTION_ALREADY_REPLACED: ['تم عكس هذا السند أو تصحيحه سابقًا. افتح سجل العمليات لعرض السند البديل.', 'This voucher was already reversed or corrected. Open the register to see the replacement.'],
  SALE_CORRECTION_PROCEEDS_LINK: ['تعذر مطابقة سند القبض المرتبط بالبيع.', 'The linked proceeds could not be reconciled.'],
  SALE_CORRECTION_ALLOCATION_LINK: ['تعذر مطابقة الكمية المباعة مع دفعات الأصل.', 'The sale quantity could not be reconciled with the asset lots.'],
  SALE_CORRECTION_PROCEEDS_USED: ['استُخدم جزء من متحصلات البيع في حركة لاحقة. يجب معالجة تلك الحركة قبل التصحيح.', 'A later movement used the sale proceeds. Resolve that movement before correcting the sale.'],
  SALE_CORRECTION_ACCOUNT_OR_CURRENCY: ['اختر أصلًا وحساب إيداع شخصيين نشطين بعملات متوافقة.', 'Select an active personal asset and deposit account with compatible currencies.'],
  SALE_CORRECTION_LATER_MOVEMENTS: ['توجد حركة مرتبطة بتاريخ البيع على أحد الأصلين. راجع الحركات التي استخدمت دفعات الأصل قبل التصحيح.', 'An affected asset has a movement at or after the sale date. Review those movements before correcting the voucher.'],
  SALE_CORRECTION_FINAL_ASSESSMENT: ['التصحيح يؤثر على أصل أو حساب داخل احتساب زكاة نهائي.', 'The correction affects an asset or account included in a final Zakat assessment.'],
  SALE_CORRECTION_INSUFFICIENT_QUANTITY: ['الكمية المتاحة على الأصل في تاريخ البيع المحدد غير كافية.', 'The asset has insufficient quantity on the selected sale date.'],
};

export function personalSaleCorrectionMessage(code: string, ar: boolean) {
  return messages[code]?.[ar ? 0 : 1] ??
    (ar ? 'تعذر تأكيد التصحيح. يمكنك إعادة محاولة الحفظ بنفس البيانات.' : 'The correction could not be confirmed. You can retry saving the same details.');
}
