import {z} from 'zod';
import DecimalJs from 'decimal.js';
import {requireUser} from './auth';
import {withVoucherNumbers} from './voucher-numbers';
import {buildAssetStatement,currentAssetValuation,type StatementTransaction,type StatementLot,type StatementCommand,type StatementAllocation} from '../lib/asset-statement';
const Decimal=DecimalJs.clone({precision:40});

export const assetStatementQuery=z.object({
 asOf:z.string().date(),
 offset:z.coerce.number().int().min(0).max(20_000).default(0),
 limit:z.coerce.number().int().min(1).max(100).default(30),
});
const READ_LIMIT=5_000;

async function readRows<T>(query:()=>any,order='id'):Promise<T[]>{
 const result:T[]=[];
 for(let offset=0;offset<=READ_LIMIT;offset+=250){
  const {data,error}=await query().order(order).range(offset,offset+249);
  if(error)throw error;
  result.push(...(data??[]));
  if(result.length>READ_LIMIT)throw Error('ASSET_STATEMENT_LIMIT');
  if(!data||data.length<250)return result;
 }
 throw Error('ASSET_STATEMENT_LIMIT');
}

async function readLinked<T>(ids:string[],query:(batch:string[])=>any):Promise<T[]>{
 const rows:T[]=[];
 for(let index=0;index<ids.length;index+=100){
  rows.push(...await readRows<T>(()=>query(ids.slice(index,index+100))));
  if(rows.length>READ_LIMIT)throw Error('ASSET_STATEMENT_LIMIT');
 }
 return rows;
}

export async function readAssetStatement(id:string,options:z.infer<typeof assetStatementQuery>){
 const {supabase,user}=await requireUser();
 const {data:asset,error}=await supabase.from('asset_accounts')
  .select('id,user_id,name,unit,currency,asset_type,ownership_scope,organization_id,metadata').eq('id',id).maybeSingle();
 if(error)throw error;
 if(!asset||(!asset.organization_id&&asset.user_id!==user.id))throw Error('ASSET_NOT_FOUND');
 if(asset.metadata?.investment_id||asset.metadata?.personal_contract_id||asset.metadata?.register_source)
  throw Error('ASSET_STATEMENT_SPECIALIZED_SOURCE');
 const organizational=!!asset.organization_id;
 const scope=(query:any)=>organizational?query.eq('organization_id',asset.organization_id):query.is('organization_id',null).eq('user_id',user.id);

 const [transactions,lots,commands,baseResult]=await Promise.all([
  readRows<StatementTransaction>(()=>scope(supabase.from('transactions').select('id,transaction_date,created_at,transaction_type,quantity::text,unit_price::text,gross_value::text,currency,base_value::text,base_currency,reversal_of_transaction_id,reference,metadata').eq('asset_account_id',id)).lte('transaction_date',options.asOf)),
  readRows<StatementLot>(()=>supabase.from('lots').select('source_transaction_id,original_quantity::text,original_value_base::text,remaining_quantity::text,remaining_value_base::text,acquisition_date,metadata').eq('asset_account_id',id).lte('acquisition_date',options.asOf)),
  organizational?readRows<StatementCommand>(()=>supabase.from('asset_lifecycle_commands')
   .select('id,transaction_id,financial_event_id,operation,operation_date,created_at,applied_at,quantity,amount,lot_states')
   .eq('asset_account_id',id).eq('organization_id',asset.organization_id).lte('operation_date',options.asOf)):[],
  organizational?supabase.from('organizations').select('base_currency').eq('id',asset.organization_id).maybeSingle():
   supabase.from('profiles').select('base_currency').eq('id',user.id).maybeSingle(),
 ]);
 if(baseResult.error)throw baseResult.error;
 const baseCurrency=baseResult.data?.base_currency;
 if(!baseCurrency)throw Error('ASSET_STATEMENT_BASE_CURRENCY');

 const eventIds=organizational?[...new Set([...transactions.map(tx=>tx.metadata?.financial_event_id),...commands.map(command=>command.financial_event_id)].filter((value):value is string=>typeof value==='string'))]:[];
 const txIds=transactions.map(tx=>tx.id);
 const [events,reversals,allocations,amendments]=await Promise.all([
  readLinked<{id:string;status:string;base_currency:string}>(eventIds,batch=>supabase.from('financial_events').select('id,status,base_currency').eq('organization_id',asset.organization_id).in('id',batch)),
  readLinked<{id:string;event_id:string;changed_at:string}>(eventIds,batch=>supabase.from('financial_event_status_history').select('id,event_id,changed_at').eq('to_status','REVERSED').in('event_id',batch)),
  readLinked<StatementAllocation>(organizational?[]:txIds,batch=>supabase.from('transaction_allocations').select('transaction_id,quantity::text,value_base::text').eq('user_id',user.id).in('transaction_id',batch)),
  readLinked<{id:string;entity_id:string;created_at:string;new_data:{sale_amount?:number;unit_price?:number}|null}>(organizational?[]:transactions.filter(tx=>tx.metadata?.sale_price_amendment).map(tx=>tx.id),
   batch=>supabase.from('audit_logs').select('id,entity_id,created_at,new_data').eq('user_id',user.id).eq('action','AMEND_PERSONAL_SALE_PRICE').in('entity_id',batch)),
 ]);

 const statement=buildAssetStatement({asOf:options.asOf,baseCurrency,organizational,transactions,lots,commands,
  events,reversals,allocations,amendments});
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const knownSources=new Set(transactions.map(tx=>tx.id));
 const missingSource=lots.some(lot=>!lot.metadata?.recognition_pending&&!knownSources.has(lot.source_transaction_id));
 const visibleLots=lots.filter(lot=>!lot.metadata?.recognition_pending);
 const current=options.asOf===today?{
  quantity:visibleLots.reduce((sum,lot)=>sum.add(lot.remaining_quantity),new Decimal(0)).toString(),
  cost:visibleLots.reduce((sum,lot)=>sum.add(lot.remaining_value_base),new Decimal(0)).toString(),
 }:null;
 const reconciled=current&&statement.complete&&!missingSource&&
  new Decimal(current.quantity).eq(statement.closing.quantity??'NaN')&&
  new Decimal(current.cost).eq(statement.closing.cost??'NaN');
 const complete=statement.complete&&!missingSource&&(!current||!!reconciled);
 const valuation=reconciled&&current ? currentAssetValuation({
  type:asset.asset_type,currency:asset.currency,baseCurrency,metadata:asset.metadata??{},
  quantity:current.quantity,cost:current.cost,date:today,
 }) : null;
 const averageCost=complete&&statement.closing.quantity&&statement.closing.cost&&new Decimal(statement.closing.quantity).gt(0)
  ?new Decimal(statement.closing.cost).div(statement.closing.quantity).toDecimalPlaces(8).toString():null;
 const metalGrade=['GOLD','SILVER'].includes(asset.asset_type)?
  asset.metadata?.[asset.asset_type==='GOLD'?'karat':'purity']??asset.metadata?.karat??null:null;
 const page=statement.rows.slice(options.offset,options.offset+options.limit);
 const numbered=await withVoucherNumbers(supabase,page.map(row=>({...row,document_sequence:undefined as string|undefined,document_links:undefined as Record<string,string>|undefined})));
 return {
  asset:{id:asset.id,name:asset.name,unit:asset.unit,type:asset.asset_type,organizational,metalGrade:metalGrade==null?null:String(metalGrade)},
  valuation,averageCost,current:options.asOf===today,
  asOf:options.asOf,baseCurrency,complete,incompleteRows:statement.incompleteRows,
  reconciliation:current?(reconciled?'MATCHED':'UNRECONCILED'):'HISTORICAL',
  closing:complete?statement.closing:{quantity:null,cost:null,currency:baseCurrency},
  rows:numbered.map(row=>({...row,
   remainingQuantity:missingSource||current&&!reconciled?null:row.remainingQuantity,
   remainingCost:missingSource||current&&!reconciled?null:row.remainingCost,
   voucher:row.document_sequence??row.document_links?.source_id??null,
  })),
  total:statement.rows.length,
  nextOffset:options.offset+options.limit<statement.rows.length?options.offset+options.limit:null,
 };
}
