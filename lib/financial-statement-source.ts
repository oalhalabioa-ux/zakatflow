import {z} from 'zod';
import Decimal from 'decimal.js';
import {compileEventLedger} from './financial-event-ledger';
export const statementQuery=z.object({organization:z.string().uuid(),from:z.string().date(),to:z.string().date()}).strict().refine(q=>q.from<=q.to&&Number(q.to.slice(0,4))-Number(q.from.slice(0,4))<=1,'INVALID_STATEMENT_PERIOD');
const id=z.string().min(1),currency=z.string().regex(/^[A-Z]{3}$/),date=z.string().date(),money=z.string().regex(/^\d{1,20}(\.\d{1,4})?$/),activity=z.enum(['OPERATING','INVESTING','FINANCING']);
const account=z.object({id,organizationId:z.string().uuid(),currency,kind:z.enum(['ASSET','LIABILITY','EQUITY','REVENUE','COGS','OPEX','FINANCE','TAX']),cash:z.boolean().optional(),ar:id,en:id,presentation:z.enum(['CURRENT','NON_CURRENT','OTHER'])});
const line=z.object({id,classificationId:id,baseAmount:money,cashDirection:z.enum(['NON_CASH','INFLOW','OUTFLOW']),recognitionSign:z.union([z.literal(1),z.literal(-1)])});
const event=z.object({id,organizationId:z.string().uuid(),currency,date,eventType:id,sourceModule:id,sourceKey:id,status:z.enum(['ACTUAL','REVERSED']),lines:z.array(line).min(1),reversesEventId:id.optional()});
const rule=z.object({id,organizationId:z.string().uuid(),currency,eventType:id,sourceModule:id,classificationId:id,cashDirection:z.enum(['NON_CASH','INFLOW','OUTFLOW']),from:date,to:date,debitAccountId:id,creditAccountId:id,cashActivity:activity.optional()});
const envelope=z.object({origin:z.literal('LOCAL_QA_CANONICAL_EVENTS'),organizationId:z.string().uuid(),currency,openingDate:date,fiscalStart:date,from:date,to:date,openingSourceId:id,accounts:z.array(account).min(1).max(1000),opening:z.array(z.object({accountId:id,debit:money,credit:money})).min(1),policy:z.object({id,organizationId:z.string().uuid(),currency,approvedBy:id,approvedAt:z.string().datetime({offset:true}),rules:z.array(rule).min(1).max(5000)}),events:z.array(event).max(10000),coverage:z.object({complete:z.literal(true),scope:z.literal('ORGANIZATION_ALL_ENTITIES'),eventCount:z.number().int().min(0),lineCount:z.number().int().min(0).max(20000),readAt:z.string().datetime({offset:true})})});
const Money=Decimal.clone({precision:50});
export type StatementQuery=z.infer<typeof statementQuery>;
export function normalizeStatementSource(raw:unknown,query:StatementQuery){
 const parsed=envelope.safeParse(raw);if(!parsed.success)throw Error('STATEMENT_SOURCE_INVALID');const p=parsed.data;
 if(p.organizationId!==query.organization||p.from!==query.from||p.to!==query.to)throw Error('STATEMENT_SOURCE_SCOPE_MISMATCH');
 if(p.coverage.eventCount!==p.events.length||p.coverage.lineCount!==p.events.reduce((n,e)=>n+e.lines.length,0))throw Error('STATEMENT_SOURCE_INCOMPLETE');
 const result=compileEventLedger(p);
 const balance=new Map(p.accounts.map(a=>[a.id,new Money(0)]));
 // Detail rows are a view of these exact compiled journals and canonical opening,
 // never an independent balance input. Engine has already validated all rows.
 for(const r of p.opening)balance.set(r.accountId,new Money(r.debit).minus(r.credit));
 const monthly=new Map<string,{movement:Decimal;closing:Decimal}>();
 const start=new Date(p.from.slice(0,7)+'-01T00:00:00Z'),end=p.to.slice(0,7);
 for(let d=start;d.toISOString().slice(0,7)<=end;d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)))monthly.set(d.toISOString().slice(0,7),{movement:new Money(0),closing:new Money(0)});
 const accounts=new Map(p.accounts.map(a=>[a.id,a]));
 let runningCash=new Money(result.statements.cash.opening);
 const journals=result.source.journals;
 for(const j of journals){
  const selected=j.date>=p.from&&j.date<=p.to,allCash=j.lines.every(l=>accounts.get(l.accountId)!.cash);
  for(const l of j.lines){const value=new Money(l.debit).minus(l.credit);balance.set(l.accountId,balance.get(l.accountId)!.plus(value));if(selected&&accounts.get(l.accountId)!.cash&&!allCash){const month=monthly.get(j.date.slice(0,7))!;month.movement=month.movement.plus(value)}}
 }
 const cashMonths=[...monthly].map(([month,v])=>{runningCash=runningCash.plus(v.movement);return{month,movement:v.movement.toFixed(4),closing:runningCash.toFixed(4)}});
 if(!runningCash.eq(result.statements.cash.closing))throw Error('CASH_FLOW_UNRECONCILED');
 return{origin:p.origin,scope:p.coverage.scope,readAt:p.coverage.readAt,policyId:p.policy.id,openingSourceId:p.openingSourceId,statements:result.statements,lineage:result.lineage,accounts:p.accounts.map(a=>({...a,balance:balance.get(a.id)!.toFixed(4)})),cashMonths};
}
export type StatementSourceSnapshot=ReturnType<typeof normalizeStatementSource>;
export type StatementView='income'|'position'|'cash-flow';
export function statementRows(s:StatementSourceSnapshot,view:StatementView,en:boolean){
 const t=(ar:string,eng:string)=>en?eng:ar,i=s.statements.income,p=s.statements.position,c=s.statements.cash;
 if(view==='income')return[[t('الإيرادات','Revenue'),i.revenue],[t('تكلفة المبيعات','Cost of sales'),new Money(i.costOfSales).negated().toFixed(4)],[t('مجمل الربح','Gross profit'),i.grossProfit],[t('المصروفات التشغيلية','Operating expenses'),new Money(i.operatingExpenses).negated().toFixed(4)],[t('الربح التشغيلي','Operating profit'),i.operatingProfit],[t('تكاليف التمويل','Finance costs'),new Money(i.finance).negated().toFixed(4)],[t('الزكاة والضريبة','Zakat and tax expense'),new Money(i.tax).negated().toFixed(4)],[t('صافي الربح','Net profit'),i.netProfit]];
 if(view==='cash-flow')return[[t('النقد الافتتاحي','Opening cash'),c.opening],[t('صافي الأنشطة التشغيلية — مباشر','Net operating activities — direct'),c.operating],[t('صافي الأنشطة الاستثمارية','Net investing activities'),c.investing],[t('صافي الأنشطة التمويلية','Net financing activities'),c.financing],[t('صافي التغير في النقد','Net change in cash'),c.movement],[t('النقد الختامي','Closing cash'),c.closing]];
 const rows:string[][]=[];
 const groups=[['ASSET','CURRENT','الأصول المتداولة','Current assets'],['ASSET','NON_CURRENT','الأصول غير المتداولة','Non-current assets'],['ASSET','OTHER','أصول أخرى غير مصنفة','Other unclassified assets'],['LIABILITY','CURRENT','الخصوم المتداولة','Current liabilities'],['LIABILITY','NON_CURRENT','الخصوم غير المتداولة','Non-current liabilities'],['LIABILITY','OTHER','خصوم أخرى غير مصنفة','Other unclassified liabilities'],['EQUITY','OTHER','حقوق الملكية','Equity']];
 for(const kind of ['ASSET','LIABILITY','EQUITY']){
  for(const[,presentation,ar,eng]of groups.filter(g=>g[0]===kind)){
   const accounts=s.accounts.filter(a=>a.kind===kind&&(kind==='EQUITY'||a.presentation===presentation));if(!accounts.length)continue;
   rows.push([t(ar,eng),'','section']);let total=new Money(0);
   for(const a of accounts){const n=new Money(a.balance).times(kind==='ASSET'?1:-1);total=total.plus(n);rows.push([en?a.en:a.ar,n.toFixed(4),'detail'])}
   if(kind!=='EQUITY')rows.push([t('إجمالي '+ar,'Total '+eng.toLowerCase()),total.toFixed(4),'subtotal']);
  }
  if(kind==='ASSET')rows.push([t('إجمالي الأصول','Total assets'),p.assets,'total']);
  if(kind==='LIABILITY')rows.push([t('إجمالي الخصوم','Total liabilities'),p.liabilities,'total']);
  if(kind==='EQUITY')rows.push([t('ربح السنة المالية حتى التاريخ','Fiscal-year profit to date'),p.fiscalProfit,'detail'],[t('إجمالي حقوق الملكية','Total equity'),p.equity,'subtotal']);
 }
 rows.push([t('إجمالي الخصوم وحقوق الملكية','Total liabilities and equity'),new Money(p.liabilities).plus(p.equity).toFixed(4),'total']);return rows;
}
export function statementSourceExport(s:StatementSourceSnapshot,view:StatementView,en:boolean):string[][]{const t=(ar:string,eng:string)=>en?eng:ar;return[[t('المصدر','Source'),s.origin],[t('المؤسسة','Organization'),s.statements.organizationId],[t('النطاق','Scope'),s.scope],[t('من','From'),s.statements.from],[t('إلى','To'),s.statements.to],[t('العملة','Currency'),s.statements.currency],[t('السياسة المعتمدة للاختبار','Test-approved policy'),s.policyId],[t('مصدر الافتتاحي','Opening source'),s.openingSourceId],[t('تنبيه','Notice'),t('بيانات اختبار محلية؛ ليست قوائم المؤسسة','Local test data; not organization financial statements')],[],[t('البند','Item'),t('الفترة الحالية','Current period')],...statementRows(s,view,en).map(r=>r.slice(0,2)),[],[t('القيود المصدرية','Source journals'),...s.statements.sourceJournalIds],[],[t('القيد','Journal'),t('الحدث','Event'),t('السطر','Line'),t('قاعدة الترحيل','Posting rule')],...s.lineage.map(l=>[l.journalId,l.eventId,l.lineId,l.ruleId])]}
