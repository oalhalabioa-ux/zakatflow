export function isAssetOpeningVoucher(asset:any){return !asset.financial_event_id&&!asset.metadata?.investment_id&&!asset.metadata?.register_source&&!['CASH','BANK','RECEIVABLE'].includes(asset.asset_type)&&(!asset.metadata?.acquisition_mode||asset.metadata.acquisition_mode==='OPENING_BALANCE');}
export function assetOpeningError(code:string,ar:boolean){
 const messages:Record<string,[string,string]>={
  ASSET_OPENING_EDIT_DENIED:['ليست لديك صلاحية تعديل هذا الرصيد الافتتاحي.','You do not have permission to edit this opening balance.'],
  ASSET_OPENING_ZAKAT_LINK:['السند مرتبط باحتساب زكاة محفوظ أو سداد؛ لا يمكن تعديل بياناته المالية أو حذفه.','This voucher is linked to a saved Zakat assessment or payment and cannot be financially edited or deleted.'],
  ASSET_OPENING_FINANCIAL_LINK:['السند مرتبط بسجل مالي؛ راجع إجراءات الاعتماد أو التصحيح من ذلك السجل.','This voucher has a financial event. Use its approval or correction workflow.'],
  ASSET_OPENING_LINKED:['السند مرتبط بحركات لاحقة؛ يجب تصحيحها قبل تعديل الرصيد أو حذفه.','This voucher has downstream movements that must be corrected first.'],
  ASSET_EDIT_CONFLICT:['تغير السند أثناء التعديل. أغلق التفاصيل وافتحها مجدداً للحصول على أحدث البيانات.','The voucher changed. Close and reopen the details before editing.'],
  ASSET_SAVED_FX_RATE_MISSING:['لا يوجد سعر صرف محفوظ لتاريخ الرصيد المحدد.','No saved exchange rate is available for the selected opening date.'],
  ASSET_OPENING_VALUES_INVALID:['راجع الاسم والتاريخ والقيمة والكمية؛ يجب أن تكون القيمة والكمية موجبتين.','Check the name, date, amount and quantity. Amount and quantity must be positive.'],
  ASSET_OPENING_REQUIRED:['هذا السجل لا يمثل سند رصيد افتتاحي قابلاً للتعديل.','This record is not an editable opening voucher.'],
  ASSET_OPENING_ARCHIVED:['تم حذف هذا السند من الأصول النشطة.','This voucher has been removed from active assets.'],
  ASSET_OPENING_OTHER_WORKSPACE:['تعديل هذا الرصيد من مسار النقد أو الذمم أو الاستثمار الخاص به.','Edit this balance in its cash, receivables or investment workspace.'],
 };
 return messages[code]?.[ar?0:1]??(ar?'تعذر تنفيذ العملية. حدّث التفاصيل وحاول مجدداً.':'The operation failed. Refresh the details and try again.');
}
