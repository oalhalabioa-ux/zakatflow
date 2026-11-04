import {z} from 'zod';
import type {OpeningDrafts,OpeningItem} from './financial-opening-preview';
export const openingScope=z.object({organization:z.string().uuid(),fiscalStart:z.string().date()}).strict();
export const openingCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('save'),...openingScope.shape,expectedVersion:z.number().int().min(0),sourceRevision:z.string().regex(/^[a-f0-9]{32}$/),entries:z.record(z.string().min(1).max(200),z.object({amount:z.string().regex(/^(|\d{1,20}(\.\d{1,4})?)$/),side:z.enum(['DEBIT','CREDIT']),reason:z.string().max(500).optional(),accountCode:z.string().regex(/^\d{4}$/).optional()}).strict()),reason:z.string().max(1000)}).strict(),
 z.object({action:z.literal('approve'),id:z.string().uuid(),expectedVersion:z.number().int().positive()}).strict(),
]);
export type OpeningEntries=OpeningDrafts & Record<string,{amount:string;side:'DEBIT'|'CREDIT';reason?:string}>;
export type OpeningRecord={id:string;version:number;status:'DRAFT'|'APPROVED'|'SUPERSEDED';entries:OpeningEntries;reason:string;source_revision:string;approved_at:string|null;approved_by:string|null};
export type OpeningWorkspaceData={bankRegister?:Record<string,{balance:string|null;openedOn:string}>;registerAsOf?:string;periodAssetOpenings?:{id:string;assetId:string;date:string;name:string;amount:string;currency:string}[];organizationId:string;fiscalStart:string;cutoff:string;currency:string;chart:{id:string;code:string;ar:string;en:string;kind:string;cash:boolean;presentation:string}[];source:{rows:(OpeningItem & {sourceIssue:string|null})[];revision:string;financialRevision:string};workspace:OpeningRecord|null;canSave:boolean;canApprove:boolean};
export function openingError(code:string,en:boolean){
 const messages:Record<string,[string,string]>={
 OPENING_SOURCE_CHANGED:['تغيّرت بيانات السندات. حدّث المصادر وراجع الفروق قبل الحفظ أو الاعتماد.','Source vouchers changed. Refresh and review the differences before saving or approving.'],
 OPENING_VERSION_CONFLICT:['عدّل مستخدم آخر المسودة. أعد تحميلها قبل المتابعة.','Another user changed the draft. Reload before continuing.'],
 OPENING_UNBALANCED:['لا يمكن الاعتماد حتى يتساوى المدين والدائن.','Debits and credits must balance before approval.'],
 OPENING_INCOMPLETE:['أكد الأرصدة الناقصة، بما فيها الأرصدة الصفرية.','Confirm every missing opening, including zero balances.'],
 OPENING_CORRECTION_REASON_REQUIRED:['أدخل سبب التصحيح للبنود المطلوب مراجعتها.','Enter a correction reason for the rows requiring review.'],
 OPENING_SOURCE_REVIEW_REQUIRED:['هناك مصادر تحتاج مراجعة تكلفة أو عملة من السجل الأصلي.','Some sources require cost or currency review in the original register.'],
 OPENING_SELF_APPROVAL_DENIED:['تتطلب سياسة المؤسسة اعتماد مستخدم آخر.','Organization policy requires approval by another user.'],
 OPENING_SUPERSESSION_REASON_REQUIRED:['أدخل سبب استبدال الافتتاحي المعتمد.','Enter a reason for replacing the approved opening.'],
 OPENING_APPROVE_DENIED:['ليست لديك صلاحيات الاعتماد والترحيل المطلوبة.','Approval and posting permissions are required.'],
 OPENING_SAVE_DENIED:['ليست لديك صلاحية حفظ الأرصدة.','You do not have permission to save openings.'],
 OPENING_ACCESS_DENIED:['لا تملك صلاحية عرض أرصدة المؤسسة.','You do not have access to this organization’s opening balances.'],
 };
 return messages[code]?.[en?1:0]??(en?'The operation could not be completed. Refresh and try again.':'تعذر إتمام العملية. حدّث الصفحة وحاول مجددًا.');
}

export function openingSourceIssue(code:string,en:boolean){const labels:Record<string,[string,string]>={CANONICAL_ACCOUNT_LINK_REQUIRED:['رصيد قديم يحتاج ربطًا موثقًا بسجل النقد أو الذمم لتجنب احتسابه مرتين.','A legacy account requires an explicit cash/receivable register link to prevent duplicate recognition.'],ASSET_COST_REVIEW_REQUIRED:['بيانات التكلفة التاريخية غير مكتملة في سند الأصل.','Historical asset cost information is incomplete.'],ASSET_COST_RECONCILIATION_REQUIRED:['تكلفة التصرف لا تتسوى مع تكلفة الأصل والإهلاك.','Disposal cost does not reconcile to historical cost and depreciation.'],SOURCE_CURRENCY_MISMATCH:['راجع عملة السند وسعر التحويل المحفوظ.','Review the source currency and saved conversion rate.'],CASH_BASE_AMOUNT_MISSING:['القيمة بالعملة الأساسية غير مكتملة للحركة النقدية.','The cash movement has no complete base-currency value.'],NEGATIVE_OBLIGATION_REQUIRES_REVIEW:['رصيد الذمة يحتاج مراجعة التسويات من السجل الأصلي.','The obligation balance requires source allocation review.']};return labels[code]?.[en?1:0]??(en?'Review this source in its original register.':'راجع بيانات هذا المصدر من سجله الأصلي.')}
