import Decimal from 'decimal.js';
export const OPENING_TABS=[['summary','ميزان المراجعة','Trial balance','balance'],['customers','العملاء','Customers','users'],['suppliers','الموردون','Suppliers','truck'],['cash','النقد والبنوك','Cash & banks','bank'],['assets','الأصول والإهلاك','Assets & depreciation','building'],['loans','القروض','Loans','file'],['advances','السلف والعهد','Advances','wallet'],['other','استثمارات وأخرى','Investments & other','layers'],['equity','حقوق الملكية','Equity','crown']] as const;
export type OpeningTab=typeof OPENING_TABS[number][0];
export type OpeningItem={id:string;tab:Exclude<OpeningTab,'summary'>;accountCode:string;accountAr:string;accountEn:string;ar:string;en:string;normal:'DEBIT'|'CREDIT';inactive?:boolean;vouchers:{canonicalId:string;number:string;debit:string;credit:string}[]};
export type OpeningDraft={amount:string;side:'DEBIT'|'CREDIT'};
export type OpeningDrafts=Record<string,OpeningDraft>;
const Money=Decimal.clone({precision:50});
const zero=()=>new Money(0),split=(v:Decimal)=>({debit:(v.gt(0)?v:zero()).toFixed(4),credit:(v.lt(0)?v.negated():zero()).toFixed(4)});
/** Synthetic master records include people without opening vouchers. Never a live adapter. */
export function openingPreviewItems(organization:'holding'|'services'):OpeningItem[]{
 const definitions:[string,OpeningItem['tab'],string,string,string,string,string,OpeningItem['normal'],string|null][]=[
 ['c1','customers','1100','الذمم المدينة','Trade receivables','شركة المدار التجارية','Al Madar Trading','DEBIT','25000'],['c2','customers','1100','الذمم المدينة','Trade receivables','مؤسسة آفاق للخدمات','Afaq Services','DEBIT',null],['c3','customers','1100','الذمم المدينة','Trade receivables','شركة النور','Al Noor Company','DEBIT','0'],['c4','customers','1100','الذمم المدينة','Trade receivables','شركة الرواد — غير نشطة','Al Rowad — inactive','DEBIT','10000'],
 ['s1','suppliers','2100','الذمم الدائنة','Trade payables','شركة التوريدات المتقدمة','Advanced Supplies','CREDIT','18000'],['s2','suppliers','2100','الذمم الدائنة','Trade payables','مؤسسة البناء الحديث','Modern Building','CREDIT',null],['s3','suppliers','2100','الذمم الدائنة','Trade payables','شركة التقنية العربية','Arabian Technology','CREDIT','12000'],
 ['b1','cash','1000','نقد وبنوك','Cash & banks','الحساب البنكي الرئيسي','Main bank account','DEBIT','45000'],['b2','cash','1000','نقد وبنوك','Cash & banks','الصندوق الرئيسي','Main cash box','DEBIT',null],
 ['a1','assets','1500','الأصول الثابتة','Property & equipment','معدات تشغيلية — تكلفة','Operating equipment — cost','DEBIT','120000'],['a2','assets','1590','مجمع الإهلاك','Accumulated depreciation','معدات تشغيلية — مجمع الإهلاك','Operating equipment — accumulated depreciation','CREDIT','20000'],['a3','assets','1500','الأصول الثابتة','Property & equipment','سيارة إدارية','Administrative vehicle','DEBIT',null],
 ['l1','loans','2200','قروض دائنة','Borrowings','تمويل بنكي طويل الأجل','Long-term bank financing','CREDIT','60000'],['l2','loans','1200','قروض مدينة','Loans receivable','قرض مدين — شركة شقيقة','Loan to related company','DEBIT',null],
 ['e1','advances','1300','سلف وعهد','Employee advances','أحمد سالم — عهدة','Ahmed Salem — advance','DEBIT','5000'],['e2','advances','1300','سلف وعهد','Employee advances','خالد علي — سلفة','Khaled Ali — advance','DEBIT',null],
 ['o1','other','1600','استثمارات','Investments','استثمار طويل الأجل','Long-term investment','DEBIT','40000'],['o2','other','2300','مصروفات مستحقة','Accrued expenses','مصروفات مستحقة سابقة','Prior accrued expenses','CREDIT',null],
 ['q1','equity','3100','رأس المال','Share capital','رأس المال المدفوع','Paid-in capital','CREDIT','100000'],['q2','equity','3200','احتياطيات','Reserves','الاحتياطي النظامي','Statutory reserve','CREDIT',null],['q3','equity','3300','أرباح محتجزة','Retained earnings','الأرباح المحتجزة','Retained earnings','CREDIT',null],
 ];
 return definitions.map(([id,tab,accountCode,accountAr,accountEn,ar,en,normal,value],i)=>{const amount=value===null?null:new Money(value).times(organization==='services'?'.4':1).toFixed(4);return{id:organization+'-'+id,tab,accountCode,accountAr,accountEn,ar:organization==='services'?'الخدمات · '+ar:ar,en:organization==='services'?'Services · '+en:en,normal,inactive:id==='c4',vouchers:amount===null?[]:[{canonicalId:organization+'-opening-'+id,number:'OPN-'+String(i+1).padStart(4,'0'),debit:normal==='DEBIT'?amount:'0.0000',credit:normal==='CREDIT'?amount:'0.0000'}]}});
}
export function openingPreviewState(items:OpeningItem[],drafts:OpeningDrafts){
 const seenPhysical=new Set<string>();
 const rows=items.map(item=>{
  let existing=zero();const vouchers=new Map<string,OpeningItem['vouchers'][number]>();
  for(const v of item.vouchers){const prior=vouchers.get(v.canonicalId);if(prior){if(!new Money(prior.debit).eq(v.debit)||!new Money(prior.credit).eq(v.credit))throw Error('CONFLICTING_OPENING_SOURCE');continue}if(seenPhysical.has(v.canonicalId))throw Error('OPENING_SOURCE_ATTACHED_TWICE');seenPhysical.add(v.canonicalId);vouchers.set(v.canonicalId,v);existing=existing.plus(v.debit).minus(v.credit)}
  const draft=drafts[item.id],entered=Boolean(draft&&draft.amount!==''),valid=!entered||/^\d{1,20}(\.\d{1,4})?$/.test(draft.amount),known=vouchers.size>0||entered;
  const supplement=entered&&valid?new Money(draft.amount).times(draft.side==='CREDIT'?-1:1):zero(),final=known&&valid?existing.plus(supplement):null;
  const status=!valid?'invalid':!known?'missing':(!supplement.isZero()&&vouchers.size||final!==null&&!final.isZero()&&(final.gt(0)!==(item.normal==='DEBIT')))?'review':'entered';
  return{...item,vouchers:[...vouchers.values()],existing:vouchers.size?existing.toFixed(4):null,supplement:entered&&valid?supplement.toFixed(4):null,final:final?.toFixed(4)??null,status,valid,entered};
 });
 const accounts=new Map<string,{code:string;ar:string;en:string;existing:Decimal;supplement:Decimal;final:Decimal;pending:number}>();
 for(const r of rows){const a=accounts.get(r.accountCode)??{code:r.accountCode,ar:r.accountAr,en:r.accountEn,existing:zero(),supplement:zero(),final:zero(),pending:0};a.existing=a.existing.plus(r.existing??0);a.supplement=a.supplement.plus(r.supplement??0);a.final=a.final.plus(r.final??0);a.pending+=r.final===null?1:0;accounts.set(r.accountCode,a)}
 const trialBalance=[...accounts.values()].sort((a,b)=>a.code.localeCompare(b.code)).map(a=>({...a,existing:split(a.existing),supplement:split(a.supplement),final:split(a.final)}));
 const debit=trialBalance.reduce((n,a)=>n.plus(a.final.debit),zero()),credit=trialBalance.reduce((n,a)=>n.plus(a.final.credit),zero());
 return{rows,trialBalance,totals:{debit:debit.toFixed(4),credit:credit.toFixed(4),difference:debit.minus(credit).toFixed(4)},pending:rows.filter(r=>r.final===null).length,invalid:rows.filter(r=>!r.valid).length,review:rows.filter(r=>r.status==='review').length,sourceCount:seenPhysical.size,entered:rows.filter(r=>r.final!==null).length};
}
export function openingPreviewExport(state:ReturnType<typeof openingPreviewState>,visible:typeof state.rows,en:boolean){
 const t=(ar:string,english:string)=>en?english:ar;
 return[[t('المصدر','Source'),'SYNTHETIC OPENING PREVIEW — NO DATABASE WRITE'],[t('تاريخ الافتتاحي','Opening date'),'2026-01-01'],[t('العملة','Currency'),'SAR'],[t('غير مدخل / غير صالح','Missing / invalid'),String(state.pending)],[t('فرق الميزان لجميع الأرصدة المدخلة','Trial balance difference for all entered balances'),state.totals.difference],[],[t('الاسم','Name'),t('رقم الحساب','Account code'),t('الرصيد من السندات','Voucher balance'),t('الإضافة / التسوية','Supplement / adjustment'),t('الافتتاحي النهائي','Final opening'),t('الحالة','Status'),t('السندات','Vouchers')],...visible.map(r=>[en?r.en:r.ar,r.accountCode,r.existing??'',r.supplement??'',r.final??'',r.status,r.vouchers.map(v=>v.number).join(', ')])];
}
