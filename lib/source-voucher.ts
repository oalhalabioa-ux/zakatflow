import {transactionVoucher,voucherNumber,type VoucherIdentity} from './voucher-identity';
export const voucherDomains=['ASSET','INVOICE','EVENT','DEBT','PERSONAL_CONTRACT','PERSONAL_MOVEMENT','PARTICIPATION','PARTICIPATION_MOVEMENT','INVESTMENT','INVESTMENT_MOVEMENT','CASH_FLOW','CASH_SETTLEMENT','TRANSFER','ZAKAT','PAYROLL','ADVANCE','PERSONAL_FINANCING'] as const;
export type VoucherDomain=typeof voucherDomains[number];
const prefixes:Record<VoucherDomain,string>={ASSET:'TX',INVOICE:'INV',EVENT:'EV',DEBT:'DC',PERSONAL_CONTRACT:'PC',PERSONAL_MOVEMENT:'PM',PARTICIPATION:'IC',PARTICIPATION_MOVEMENT:'IM',INVESTMENT:'IV',INVESTMENT_MOVEMENT:'IO',CASH_FLOW:'CF',CASH_SETTLEMENT:'CS',TRANSFER:'TR',ZAKAT:'ZP',PAYROLL:'PR',ADVANCE:'AD',PERSONAL_FINANCING:'LN'};
const kinds:Record<string,[string,string]>={OPENING_BALANCE:['رصيد افتتاحي','Opening balance'],PURCHASE:['شراء أصل','Asset purchase'],SALE:['بيع أصل','Asset sale'],DEPRECIATION:['إهلاك','Depreciation'],DISPOSAL:['استبعاد أصل','Asset disposal'],ADJUSTMENT:['تسوية أصل','Asset adjustment'],ADD:['إضافة أصل / رصيد','Asset / balance addition'],WITHDRAWAL:['سند صرف','Payment voucher'],TRANSFER_IN:['تحويل وارد','Transfer in'],TRANSFER_OUT:['تحويل صادر','Transfer out'],REVERSAL:['عكس سند','Reversal'],ZAKAT_PAYMENT:['سداد زكاة','Zakat payment'],FUND:['تمويل أصل العقد','Contract funding'],SETTLE:['تسوية أصل العقد','Principal settlement'],SETTLE_CHARGE:['تسوية تكلفة / ربح','Charge / profit settlement'],CHARGE:['إثبات تكلفة تمويل','Finance charge'],PROFIT:['إثبات ربح','Profit recognition'],LOSS:['إثبات خسارة','Loss recognition'],CAPITAL_RECEIPT:['إثبات رأس مال','Capital funding'],CAPITAL_RETURN:['رد / استرداد رأس مال','Capital return'],DISTRIBUTION:['توزيع أرباح','Profit distribution'],INCOME:['قبض عائد استثمار','Investment income'],REDEEM:['استرداد استثمار','Investment redemption']};
const tables:Record<VoucherDomain,string>={ASSET:'transactions',INVOICE:'vat_documents',EVENT:'financial_events',DEBT:'debt_contracts',PERSONAL_CONTRACT:'personal_contracts',PERSONAL_MOVEMENT:'personal_contract_movements',PARTICIPATION:'participation_contracts',PARTICIPATION_MOVEMENT:'participation_movements',INVESTMENT:'investment_contracts',INVESTMENT_MOVEMENT:'investment_operations',CASH_FLOW:'liquidity_flows',CASH_SETTLEMENT:'liquidity_settlements',TRANSFER:'transfers',ZAKAT:'zakat_payments',PAYROLL:'debt_payroll_requests',ADVANCE:'debt_operation_requests',PERSONAL_FINANCING:'personal_financings'};
export function sourceVoucher(domain:VoucherDomain,row:any={},ar=true):Required<Pick<VoucherIdentity,'voucherNumber'|'voucherType'>>&VoucherIdentity{
 const t=(a:string,e:string)=>ar?a:e,id=String(row.id??''),terms=row.terms??row;
 let type=t('سند مالي','Financial voucher'),number=id?voucherNumber(id,prefixes[domain]):'';
 if(domain==='ASSET'){
  const kind=row.operation_type??row.transaction_type??'ADD',identity=transactionVoucher({...row,id,transaction_type:kind});
  number=row.purchase_number||(id?identity.voucherNumber:'')||number;type=kind==='OPENING_BALANCE'&&row.metadata?.personal_contract_id?t('إثبات رصيد عقد','Contract balance recognition'):kinds[kind]?.[ar?0:1]??t('حركة أصل','Asset movement');
 }else if(domain==='INVOICE'){
  const kind=row.document_kind??row.kind??'INVOICE',side=row.document_type??row.side;
  number=row.purchase_number||row.number||row.invoice_number||row.document_number||number;
  type=kind==='CREDIT_NOTE'?t('إشعار دائن','Credit note'):kind==='DEBIT_NOTE'?t('إشعار مدين','Debit note'):side==='PURCHASE'?t('فاتورة مشتريات','Purchase invoice'):t('فاتورة مبيعات','Sales invoice');
 }else if(domain==='DEBT'||domain==='PERSONAL_CONTRACT'){
  type=(terms.mode??row.mode)==='OPENING'||row.kind==='OPENING'?t('رصيد افتتاحي','Opening balance'):row.kind==='ADVANCE'?t('دفعة مقدمة','Advance payment'):row.kind==='EMPLOYEE_ADVANCE'?t('سلفة موظف','Employee advance'):row.product==='PARTICIPATION'?t('عقد استثمار ومشاركة','Participation contract'):row.financing?.product==='FINANCING'||row.product==='FINANCING'?t('عقد تمويل بعائد','Financing contract'):t('عقد قرض','Loan contract');
 }else if(domain==='PERSONAL_MOVEMENT'||domain==='PARTICIPATION_MOVEMENT'||domain==='INVESTMENT_MOVEMENT')type=kinds[row.kind]?.[ar?0:1]??t('حركة عقد','Contract movement');
 else if(domain==='PARTICIPATION')type=t('عقد استثمار ومشاركة','Participation contract');
 else if(domain==='INVESTMENT')type=terms.instrument==='DEPOSIT'?t('وديعة بنكية','Bank deposit'):terms.instrument==='BOND'?t('استثمار في سندات','Bond investment'):t('استثمار في صكوك','Sukuk investment');
 else if(domain==='CASH_FLOW')type=row.status==='ACTUAL'||row.settlement_status==='SETTLED'?(row.direction==='INFLOW'?t('تدفق قبض منفذ','Actual receipt flow'):t('تدفق صرف منفذ','Actual payment flow')):(row.direction==='INFLOW'?t('تدفق قبض مخطط','Planned receipt flow'):t('تدفق صرف مخطط','Planned payment flow'));
 else if(domain==='CASH_SETTLEMENT')type=row.direction==='INFLOW'?t('سند قبض','Receipt voucher'):t('سند صرف','Payment voucher');
 else if(domain==='TRANSFER')type=t('تحويل بين الحسابات','Account transfer');
 else if(domain==='ZAKAT')type=t('سداد زكاة','Zakat payment');
 else if(domain==='PAYROLL')type=t('استقطاع راتب','Payroll deduction');
 else if(domain==='ADVANCE')type=t('دفعة مقدمة','Advance payment');
 else if(domain==='EVENT'){
  const module=row.source_module??'';
  type=row.event_type==='REVERSAL'?t('عكس سند','Reversal'):row.event_type==='TRANSFER'?t('تحويل بين الحسابات','Account transfer'):module==='DEBT_OPERATIONS'?t('تصحيح / استرداد ذمة','Debt correction / refund'):module==='FINANCE_CONTRACTS'?t('إثبات تكلفة تمويل','Finance charge'):module.includes('PAYROLL')?t('استقطاع راتب','Payroll deduction'):module.includes('ZAKAT')?t('استحقاق / سداد زكاة','Zakat liability / payment'):module.includes('SETTLEMENT')?t('تسوية ذمة','Debt settlement'):module.includes('DEBT_CONTRACT')?t('إثبات ذمة / قرض','Debt / loan recognition'):module.includes('PARTICIPATION')?t('حركة مشاركة','Participation movement'):module.includes('INVESTMENT')?t('حركة استثمار','Investment movement'):t('سند مالي','Financial voucher');
 }
 if((domain==='ADVANCE'||domain==='PAYROLL')&&id)number=voucherNumber(row.financial_event_id??id,'EV');
 if(domain==='CASH_SETTLEMENT'&&row.financial_event_id)number=voucherNumber(row.financial_event_id,'EV');
 const table=domain==='ASSET'&&row.is_lifecycle_draft?'asset_lifecycle_commands':tables[domain];
 const official=domain==='INVOICE'&&Boolean(row.purchase_number||row.number||row.invoice_number||row.document_number)||domain==='ASSET'&&Boolean(row.purchase_number);
 if(!official)number=row.document_sequences?.[table]??row.document_sequence??number;
 return {voucherNumber:number,voucherType:type,voucherSourceTable:table,voucherSourceId:id,voucherOfficial:official};
}
