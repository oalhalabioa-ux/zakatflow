import { z } from 'zod';

export const sharingModeSchema = z.enum(['disabled', 'read', 'edit']);
export const shareAccessSchema = z.enum(['read', 'edit']);

export const shareAuditEventLabels = {
  'feasibility.organization_share_share': ['مشاركة إصدار', 'Revision shared'],
  'feasibility.organization_share_revoke': ['إلغاء الوصول', 'Access revoked'],
  'feasibility.organization_share_edit': ['تعديل النسخة المشتركة', 'Shared copy edited'],
  'feasibility.share_proposal_submit': ['إرسال طلب تعديل', 'Change request submitted'],
  'feasibility.share_proposal_approve': ['قبول طلب تعديل', 'Change request approved'],
  'feasibility.share_proposal_reject': ['رفض طلب تعديل', 'Change request declined'],
} as const;

export const shareAuditEventsSchema = z.array(z.object({
  id: z.string().uuid(),
  kind: z.enum(Object.keys(shareAuditEventLabels) as (keyof typeof shareAuditEventLabels)[]),
  occurred_at: z.iso.datetime({offset:true}),
  recipient_organization_id: z.string().uuid().nullable(),
  proposal_id: z.string().uuid().nullable(),
  source_revision: z.number().int().positive().nullable(),
  shared_revision: z.number().int().positive().nullable(),
  approved_revision: z.number().int().positive().nullable(),
}).strict()).max(100);
export type ShareAuditEvent = z.infer<typeof shareAuditEventsSchema>[number];

export const sharedStudyFields = {
  monthlyUnits: ['الوحدات الشهرية', 'Monthly units'],
  unitPrice: ['سعر الوحدة', 'Unit price'],
  variableCost: ['التكلفة المتغيرة للوحدة', 'Variable cost per unit'],
  monthlyFixedCost: ['التكلفة الثابتة الشهرية', 'Monthly fixed cost'],
  workingCapital: ['رأس المال العامل', 'Working capital'],
  discountRatePct: ['معدل الخصم (%)', 'Discount rate (%)'],
  priceCarton: ['سعر الكرتون', 'Carton price'],
  variableCarton: ['التكلفة المتغيرة للكرتون', 'Variable cost per carton'],
  fixedMonth: ['التكلفة الثابتة الشهرية', 'Monthly fixed cost'],
  bottlesHour: ['العبوات في الساعة', 'Bottles per hour'],
  discountRate: ['معدل الخصم (%)', 'Discount rate (%)'],
} as const;
export type SharedStudyField = keyof typeof sharedStudyFields;
export function sharedStudyFieldMaximum(field: SharedStudyField) {
  if (field === 'discountRate') return 1000;
  if (field === 'discountRatePct') return 100000;
  return 1e12;
}

export const sharedStudyPatchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  notes: z.string().max(5000).optional(),
  ...Object.fromEntries(Object.keys(sharedStudyFields).map(field => [
    field, z.number().finite().min(0).max(sharedStudyFieldMaximum(field as SharedStudyField)).optional(),
  ])),
}).strict().refine(value => Object.keys(value).length > 0);
