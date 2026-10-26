/** Display codes are stable source identifiers, independent of editable external references. */
export type VoucherIdentity={voucherNumber?:string;voucherType?:string;isOpening?:boolean};
export function voucherNumber(id:string,prefix='TX'){return `${prefix}-${id.replaceAll('-','').slice(0,12).toUpperCase()}`;}
export function transactionVoucher(t:{id:string;transaction_type:string;metadata?:any},original?:{transaction_type:string}):VoucherIdentity{
 const kind=t.transaction_type,m=t.metadata??{};
 if(kind==='REVERSAL'&&original?.transaction_type==='OPENING_BALANCE')return {voucherNumber:voucherNumber(t.id,'RV'),voucherType:'عكس رصيد افتتاحي',isOpening:true};
 if(kind==='OPENING_BALANCE')return {voucherNumber:voucherNumber(t.id,'OB'),voucherType:'رصيد افتتاحي',isOpening:true};
 const funding=m.source==='PERSONAL_FINANCING'&&m.purpose==='FUNDING';
 const incoming=['ADD','TRANSFER_IN'].includes(kind);
 const type=kind==='REVERSAL'?'عكس سند':funding?(m.kind==='ADVANCE'?'دفعة مقدمة':incoming?'إضافة قرض مستلم':'إضافة قرض ممنوح'):kind==='TRANSFER_IN'?'تحويل وارد':kind==='TRANSFER_OUT'?'تحويل صادر':incoming?'سند قبض':['WITHDRAWAL','ZAKAT_PAYMENT'].includes(kind)?'سند صرف':'حركة أصل';
 return {voucherNumber:voucherNumber(t.id,funding?'LN':kind==='REVERSAL'?'RV':incoming?'RC':'PV'),voucherType:type,isOpening:false};
}

export function movementType(kind:string,source?:string){
 const labels:Record<string,string>={OPENING_BALANCE:'رصيد افتتاحي',INVOICE:'إثبات ذمة',PAYMENT:'سند سداد',CASH:'تسوية نقدية',CASH_SETTLEMENT:'تسوية نقدية',REVERSAL:'عكس سند',ADJUSTMENT:'تعديل ذمة',ADVANCE:'دفعة مقدمة',ADVANCE_APPLICATION:'تخصيص دفعة مقدمة',TRANSFER_IN:'تحويل وارد',TRANSFER_OUT:'تحويل صادر'};
 return labels[kind]??(source==='FINANCE_CONTRACTS'?'إثبات تكلفة تمويل':'تسوية ذمة');
}
