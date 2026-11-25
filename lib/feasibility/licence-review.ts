import type { LegalItem } from './engine';

export function licenceReviewReason(item: LegalItem) {
  if (item.status === 'VERIFIED') return item.notes.trim() ? null : 'MISSING_REFERENCE';
  return item.status;
}

const reasons = {
  NOT_STARTED: ['لم يبدأ التحقق', 'Verification not started'],
  UNDER_REVIEW: ['التحقق قيد المراجعة', 'Verification under review'],
  BLOCKED: ['مانع مسجل', 'Recorded blocker'],
  MISSING_REFERENCE: ['مرجع المستند مطلوب', 'Evidence reference required'],
} as const;

export function licenceReviewLabel(item: LegalItem, locale: string) {
  const reason = licenceReviewReason(item);
  return reason && reasons[reason][locale === 'ar' ? 0 : 1];
}
