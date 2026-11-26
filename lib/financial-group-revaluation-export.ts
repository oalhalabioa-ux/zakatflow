import { z } from 'zod';
import type { liveGroupV2Revaluation } from '../services/financial-group-v2-revaluation';

export type GroupRevaluationReview = Awaited<ReturnType<typeof liveGroupV2Revaluation>>;

const closingQuote = z.object({
  rate: z.string(),
  quoteDate: z.string().date(),
  policy: z.object({ source: z.string() }),
});

const coverageLabels: Record<string, [string, string]> = {
  REPORTING_FX_POLICY_MISSING: ['سياسة الصرف غير معتمدة للزوج والغرض', 'No approved FX policy for this pair and purpose'],
  REPORTING_FX_QUOTE_MISSING: ['سعر الصرف المعتمد غير متاح للتاريخ', 'Approved FX quote missing for this date'],
  REPORTING_FX_QUOTE_AMBIGUOUS: ['يتوفر أكثر من سعر مطابق للسياسة', 'More than one quote matches the policy'],
  GROUP_FX_FISCAL_START_REQUIRED: ['تبدأ مراجعة الترجمة من أول السنة المالية', 'Translation review requires the fiscal year start'],
  GROUP_FX_EQUITY_MOVEMENT_UNSUPPORTED: ['تغطية حركات حقوق الملكية غير متاحة لهذه الترجمة', 'Equity movements are outside this translation review'],
};

const purposeLabels: Record<string, [string, string]> = {
  PRIOR_CLOSING: ['الإقفال السابق', 'Prior closing'],
  TRANSACTION: ['الحركة', 'Transaction'],
  CLOSING: ['الإقفال', 'Closing'],
};

export function groupRevaluationRows(review: GroupRevaluationReview, company: string, from: string, en: boolean) {
  const t = (ar: string, english: string) => en ? english : ar;
  const label = (map: Record<string, [string, string]>, key: string) => map[key]?.[en ? 1 : 0] ?? key;
  const { ledger, policy, publishedClosingReference, translatedCompany, currency } = review;
  const pair = `${ledger.companyCurrency}/${currency}`;
  const rows = [
    [t('نوع المراجعة', 'Review type'), t('ورقة مراجعة قبل التوحيد', 'Pre-consolidation worksheet')],
    [t('الشركة محل المراجعة', 'Reviewed company'), company],
    [t('الفترة', 'Period'), from, ledger.asOf],
    [t('قيد إعادة التقييم', 'Revaluation journal'), ledger.journalId],
    [t('سطر القيد', 'Journal line'), ledger.lineId],
    [t('الذمة', 'Obligation'), ledger.obligationId],
    [t('مستند المصدر', 'Source document'), ledger.documentModule, ledger.documentId],
    [t('تاريخ إعادة التقييم', 'Revaluation date'), ledger.cutoff],
    [t('السعر المحفوظ مع القيد', 'Stored posting quote'), String(ledger.sourceQuote.rate), ledger.sourceQuote.quoteDate, ledger.sourceQuote.quoteId],
    [t('أثر الذمة غير النقدي', 'Non-cash obligation movement'), ledger.debtMovement, ledger.companyCurrency, ledger.debtAccountId],
    [t('أثر الحساب المقابل غير النقدي', 'Non-cash offset movement'), ledger.offsetMovement, ledger.companyCurrency, ledger.offsetAccountId],
    [t('العكس في الفترة', 'Reversal in the period'), ...(ledger.reversal
      ? [ledger.reversal.date, ledger.reversal.journalId, ledger.reversal.lineId]
      : [t('لا يوجد عكس ضمن الفترة', 'No reversal in this period')])],
  ];
  if (ledger.companyCurrency !== currency) {
    const quote = closingQuote.safeParse('selected' in policy ? policy.selected : undefined);
    rows.push(
      [t('مرجع الإقفال المنشور', 'Published closing reference'), pair, ledger.asOf,
        publishedClosingReference ?? t('لا يوجد سعر منشور في المصدر المرتبط', 'No quote in the linked publication')],
      [t('سعر الإقفال باعتماد المؤسسة', 'Institution-approved closing quote'), pair,
        ...(quote.success ? [quote.data.rate, quote.data.quoteDate, quote.data.policy.source] :
          [coverageLabels[policy.status]?.[en ? 1 : 0] ?? t('تعذّر التحقق من السعر المعتمد', 'Approved quote could not be verified')])],
    );
  }
  if (translatedCompany && 'netProfit' in translatedCompany) {
    rows.push(
      [t('صافي ربح الشركة بعد الترجمة', 'Translated company net profit'), translatedCompany.netProfit, currency],
      [t('أصول الشركة بعد الترجمة', 'Translated company assets'), translatedCompany.position.assets, currency],
      [t('التزامات الشركة بعد الترجمة', 'Translated company liabilities'), translatedCompany.position.liabilities, currency],
      [t('النقد المترجم في الإقفال', 'Translated closing cash'), translatedCompany.cash.closing, currency],
      [t('أثر الصرف على النقد المترجم', 'Exchange rate effect on translated cash'), translatedCompany.cash.exchangeRateEffect, currency],
      ...translatedCompany.approvedQuotes.map(quote => [label(purposeLabels, quote.purpose), pair, quote.date,
        quote.rate, quote.quoteDate, quote.publication, quote.policyId, quote.quoteId]),
    );
  } else if (translatedCompany) {
    const request = 'rateRequest' in translatedCompany ? translatedCompany.rateRequest : undefined;
    rows.push([t('تغطية ترجمة الشركة', 'Company translation coverage'), label(coverageLabels, translatedCompany.status),
      ...(request ? [`${request.fromCurrency}/${request.toCurrency}`, label(purposeLabels, request.purpose), request.asOf] : [])]);
  }
  return rows;
}
