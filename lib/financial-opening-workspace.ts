import {z} from 'zod';
import type {OpeningDrafts,OpeningItem} from './financial-opening-preview';
export const openingScope=z.object({organization:z.string().uuid(),fiscalStart:z.string().date()}).strict();
export const openingCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('save'),...openingScope.shape,expectedVersion:z.number().int().min(0),sourceRevision:z.string().regex(/^[a-f0-9]{32}$/),entries:z.record(z.string().min(1).max(200),z.object({amount:z.string().regex(/^(|\d{1,20}(\.\d{1,4})?)$/),side:z.enum(['DEBIT','CREDIT']),reason:z.string().max(500).optional(),accountCode:z.string().regex(/^\d{4}(?:\d{2}){0,3}$/).optional()}).strict()),reason:z.string().max(1000)}).strict(),
 z.object({action:z.literal('approve'),id:z.string().uuid(),expectedVersion:z.number().int().positive()}).strict(),
]);
export type OpeningEntries=OpeningDrafts & Record<string,{amount:string;side:'DEBIT'|'CREDIT';reason?:string}>;
export type OpeningRecord={id:string;version:number;status:'DRAFT'|'APPROVED'|'SUPERSEDED';entries:OpeningEntries;reason:string;source_revision:string;approved_at:string|null;approved_by:string|null};
export type OpeningWorkspaceData={replacesApproved?:boolean;cashAccountCodes?:Record<string,string>;bankRegister?:Record<string,{balance:string|null;openedOn:string}>;registerAsOf?:string;periodAssetOpenings?:{id:string;assetId:string;date:string;name:string;amount:string;currency:string}[];organizationId:string;fiscalStart:string;cutoff:string;currency:string;chart:{id:string;code:string;ar:string;en:string;kind:string;cash:boolean;presentation:string;reportingCode?:string;parentCode?:string}[];source:{rows:(OpeningItem & {sourceIssue:string|null})[];revision:string;financialRevision:string};workspace:OpeningRecord|null;canSave:boolean;canApprove:boolean};
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
 OPENING_ACCOUNT_INVALID:['الحساب الفرعي غير متاح أو لا يتبع الحساب الرقابي للمصدر. حدّث دليل الحسابات وأعد المحاولة.','The subaccount is unavailable or does not belong to the source control account. Refresh the chart and try again.'],
 OPENING_ACCESS_DENIED:['لا تملك صلاحية عرض أرصدة المؤسسة.','You do not have access to this organization’s opening balances.'],
 };
 return messages[code]?.[en?1:0]??(en?'The operation could not be completed. Refresh and try again.':'تعذر إتمام العملية. حدّث الصفحة وحاول مجددًا.');
}

export function fiscalError(code:string,en:boolean){
 const messages:Record<string,[string,string]>={
 FISCAL_BUDGET_PERIOD_REVIEW_REQUIRED:['توجد موازنات مرتبطة بتقويم مختلف؛ يلزم إجراء تصحيح معتمد دون تغيير بياناتها تلقائيًا.','Linked budgets use a different calendar; use an approved correction without automatically changing their records.'],
 FISCAL_CALENDAR_REQUIRED:['حدد بداية السنة المالية للمؤسسة أولاً.','Configure this organization’s fiscal year first.'],
 FISCAL_OPENING_NOT_STARTED:['يمكن تجهيز المسودة؛ يبدأ اعتماد الافتتاح عند حلول تاريخ بداية السنة.','The draft may be prepared now; approve the opening when its fiscal year begins.'],
 FISCAL_PREVIOUS_YEAR_NOT_CLOSED:['أقفل السنة السابقة المعتمدة أولاً ليأتي الافتتاح التالي من ختاميها الصحيح.','Close the preceding approved year before adopting its closing balances as the next opening.'],
 FISCAL_START_MISMATCH:['اختر بداية سنة مطابقة لإعداد السنة المالية للمؤسسة.','Choose a year start matching the organization’s fiscal calendar.'],
 FISCAL_LEGACY_PERIOD_REVIEW_REQUIRED:['توجد فترات سابقة تختلف عن الإعداد المختار؛ يلزم مراجعتها قبل تغيير السنة المالية.','Existing periods differ from this calendar and require review before changing it.'],
 FISCAL_CALENDAR_IN_USE:['إعداد السنة مستخدم في فترات محاسبية. يلزم مسار تصحيح موثق لتغييره.','This calendar is used by accounting periods. Changing it requires a documented correction.'],
 FISCAL_APPROVED_SOURCE_CORRECTION_REQUIRED:['الرصيد مرتبط بفترة أو سنة تالية معتمدة؛ استخدم مسار التصحيح الموثق.','This balance affects an approved period or successor. Use the documented correction process.'],
 FISCAL_SOURCE_ALREADY_ASSIGNED:['سبق إسناد هذا المصدر. راجع الإسناد المسجل قبل محاولة تغييره.','This source is already assigned. Review its recorded assignment before changing it.'],
 FISCAL_SUBLEDGER_UNRECONCILED:['لم تتطابق أرصدة السجلات التفصيلية مع ميزان المراجعة. صحح المصدر قبل الإقفال.','Register balances do not match the trial balance. Reconcile the source before closing.'],
 FISCAL_SUBLEDGER_INCOMPLETE:['توجد حسابات جديدة بلا رصيد موثق؛ أكملها أو أكد رصيدها الصفري قبل الإقفال.','New register accounts lack documented balances. Complete them or confirm zero before closing.'],
 FISCAL_SUBLEDGER_SOURCE_REVIEW_REQUIRED:['أحد مصادر السجلات يحتاج مراجعة محاسبية قبل الإقفال.','A register source requires accounting review before closing.'],
 FISCAL_PERIOD_CLOSED:['السنة مقفلة. يلزم إجراء تصحيح موثق قبل تعديل بياناتها.','This year is closed. A documented correction is required before changing it.'],
 FISCAL_YEAR_NOT_FINISHED:['لا يمكن إقفال سنة لم تنتهِ بعد.','A year cannot be closed before it ends.'],
 FISCAL_PENDING_OPERATIONS:['توجد عمليات غير مكتملة خلال السنة؛ راجع مسوداتها قبل الإقفال.','The year contains pending operations. Review their drafts before closing.'],
 FISCAL_SUCCESSOR_REQUIRES_CORRECTION:['افتتاح السنة التالية معتمد. يجب معالجة التصحيح عبر الفترات المرتبطة دون تغيير القيود بصمت.','The successor opening is approved. Correct the linked periods without silently changing approved balances.'],
 FISCAL_ROLLOVER_CORRECTION_REQUIRED:['الافتتاح المرحل يجب أن يطابق الإقفال. عالج الفرق بتصحيح موثق.','The carried opening must match the close. Use a documented correction for differences.'],
 FISCAL_VERSION_CONFLICT:['تغير الإصدار؛ حدّث البيانات قبل المتابعة.','The version changed. Refresh before continuing.'],
 FISCAL_ACCESS_DENIED:['لم تعد لديك صلاحية قراءة بيانات هذه المؤسسة.','You no longer have access to this organization.'],
 FISCAL_WRITE_DENIED:['ليست لديك صلاحية تعديل إعدادات السنة أو مصادرها.','You do not have permission to change the fiscal calendar or sources.'],
 FISCAL_CLOSE_DENIED:['يتطلب الإقفال صلاحيات الاعتماد والترحيل وحدود المبالغ المناسبة.','Closing requires approval and posting permissions with appropriate amount limits.'],
 };
 return messages[code]?.[en?1:0]??openingError(code,en);
}

export function openingSourceIssue(code:string,en:boolean){const labels:Record<string,[string,string]>={OPENING_EVENT_NOT_POSTED:['السند الافتتاحي لم يستكمل الاعتماد والترحيل بعد.','The opening event is not approved and posted yet.'],CANONICAL_ACCOUNT_LINK_REQUIRED:['رصيد قديم يحتاج ربطًا موثقًا بسجل النقد أو الذمم لتجنب احتسابه مرتين.','A legacy account requires an explicit cash/receivable register link to prevent duplicate recognition.'],ASSET_COST_REVIEW_REQUIRED:['بيانات التكلفة التاريخية غير مكتملة في سند الأصل.','Historical asset cost information is incomplete.'],ASSET_COST_RECONCILIATION_REQUIRED:['تكلفة التصرف لا تتسوى مع تكلفة الأصل والإهلاك.','Disposal cost does not reconcile to historical cost and depreciation.'],SOURCE_CURRENCY_MISMATCH:['راجع عملة السند وسعر التحويل المحفوظ.','Review the source currency and saved conversion rate.'],CASH_BASE_AMOUNT_MISSING:['القيمة بالعملة الأساسية غير مكتملة للحركة النقدية.','The cash movement has no complete base-currency value.'],NEGATIVE_OBLIGATION_REQUIRES_REVIEW:['رصيد الذمة يحتاج مراجعة التسويات من السجل الأصلي.','The obligation balance requires source allocation review.']};return labels[code]?.[en?1:0]??(en?'Review this source in its original register.':'راجع بيانات هذا المصدر من سجله الأصلي.')}
