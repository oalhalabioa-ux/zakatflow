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
 view:z.literal('report').optional(),
 impact:z.literal('1').optional(),
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

type SaleReceipt = {id:string;asset_account_id:string;base_value:string;base_currency:string;metadata:{sale_transaction_id?:string;asset_deleted?:boolean}};
type LinkedAllocation = StatementAllocation & {lot_id:string;allocation_method?:string};
type ReceiptLot = {source_transaction_id:string;asset_account_id:string;hawl_start_date:string|null;hawl_continuity_source_lot_id:string|null};
type RecordedGoldSource = {
 source_lot_id:string;
 sold_quantity:string|number;
 proceeds_base:string|number;
 base_currency:string;
 inherited_hawl_start_date:string|null;
 reversed:boolean;
};

export async function readAssetStatement(id:string,options:z.infer<typeof assetStatementQuery>){
 const {supabase,user}=await requireUser();
 const {data:asset,error}=await supabase.from('asset_accounts')
  .select('id,user_id,name,unit,currency,asset_type,ownership_scope,organization_id,metadata').eq('id',id).maybeSingle();
 if(error)throw error;
 if(!asset||(!asset.organization_id&&asset.user_id!==user.id))throw Error('ASSET_NOT_FOUND');
 if(asset.metadata?.investment_id||asset.metadata?.personal_contract_id||asset.metadata?.register_source)
  throw Error('ASSET_STATEMENT_SPECIALIZED_SOURCE');
 const organizational=!!asset.organization_id;
 const goldAsset=asset.asset_type==='GOLD';
 const scope=(query:any)=>organizational?query.eq('organization_id',asset.organization_id):query.is('organization_id',null).eq('user_id',user.id);

 const [headerRows,lots,commands,baseResult]=await Promise.all([
  readRows<StatementTransaction>(()=>scope(supabase.from('transactions').select('id,transaction_date,created_at,transaction_type,quantity::text,unit_price::text,gross_value::text,currency,base_value::text,base_currency,reversal_of_transaction_id,reference,metadata').eq('asset_account_id',id)).lte('transaction_date',options.asOf)),
  readRows<StatementLot & {id:string;hawl_start_date:string|null}>(()=>supabase.from('lots').select('id,source_transaction_id,original_quantity::text,original_value_base::text,remaining_quantity::text,remaining_value_base::text,acquisition_date,hawl_start_date,metadata').eq('asset_account_id',id).lte('acquisition_date',options.asOf)),
  organizational?readRows<StatementCommand>(()=>supabase.from('asset_lifecycle_commands')
   .select('id,transaction_id,financial_event_id,operation,operation_date,created_at,applied_at,quantity,amount,lot_states')
   .eq('asset_account_id',id).eq('organization_id',asset.organization_id).lte('operation_date',options.asOf)):[],
  organizational?supabase.from('organizations').select('base_currency').eq('id',asset.organization_id).maybeSingle():
   supabase.from('profiles').select('base_currency').eq('id',user.id).maybeSingle(),
 ]);
 if(baseResult.error)throw baseResult.error;
 const baseCurrency=baseResult.data?.base_currency;
 if(!baseCurrency)throw Error('ASSET_STATEMENT_BASE_CURRENCY');

 const lotLines=await readLinked<LinkedAllocation>(organizational?[]:lots.map(l=>l.id),batch=>
  supabase.from('transaction_allocations').select('transaction_id,lot_id,quantity::text,value_base::text,allocation_method').eq('user_id',user.id).in('lot_id',batch));
 const known=new Set(headerRows.map(row=>row.id));
 const externalIds=[...new Set(lotLines.map(line=>line.transaction_id).filter(key=>!known.has(key)))];
 const external=await readLinked<StatementTransaction>(externalIds,batch=>scope(supabase.from('transactions')
  .select('id,transaction_date,created_at,transaction_type,quantity::text,unit_price::text,gross_value::text,currency,base_value::text,base_currency,reversal_of_transaction_id,reference,metadata'))
  .in('id',batch).lte('transaction_date',options.asOf));
 const groupedIds=new Set<string>();
 const transactions=[...headerRows,...external.filter(tx=>tx.metadata?.lot_sale_request)].map(tx=>{
  if(!tx.metadata?.lot_sale_request)return tx;
  groupedIds.add(tx.id);
  const quantity=lotLines.filter(line=>line.transaction_id===tx.id).reduce((sum,line)=>sum.plus(line.quantity),new Decimal(0));
  if(tx.currency!==tx.base_currency||tx.unit_price==null||quantity.lte(0))throw Error('ASSET_STATEMENT_ALLOCATION');
  const gross=quantity.times(tx.unit_price).toString();
  return {...tx,quantity:quantity.toString(),gross_value:gross,base_value:gross};
 });
 const groupedReversals=await readLinked<StatementTransaction>([...groupedIds],batch=>scope(supabase.from('transactions')
  .select('id,transaction_date,created_at,transaction_type,quantity::text,unit_price::text,gross_value::text,currency,base_value::text,base_currency,reversal_of_transaction_id,reference,metadata'))
  .in('reversal_of_transaction_id',batch).lte('transaction_date',options.asOf));
 for(const reversal of groupedReversals){
  const portion=transactions.find(tx=>tx.id===reversal.reversal_of_transaction_id);
  if(!portion)continue;
  const projected={...reversal,quantity:portion.quantity,gross_value:portion.gross_value,base_value:portion.base_value};
  const index=transactions.findIndex(tx=>tx.id===reversal.id);
  if(index<0)transactions.push(projected);else transactions[index]=projected;
 }
 const eventIds=organizational?[...new Set([...transactions.map(tx=>tx.metadata?.financial_event_id),...commands.map(command=>command.financial_event_id)].filter((value):value is string=>typeof value==='string'))]:[];
 const txIds=transactions.map(tx=>tx.id);
 const [events,reversals,allocations,amendments]=await Promise.all([
  readLinked<{id:string;status:string;base_currency:string}>(eventIds,batch=>supabase.from('financial_events').select('id,status,base_currency').eq('organization_id',asset.organization_id).in('id',batch)),
  readLinked<{id:string;event_id:string;changed_at:string}>(eventIds,batch=>supabase.from('financial_event_status_history').select('id,event_id,changed_at').eq('to_status','REVERSED').in('event_id',batch)),
  readLinked<LinkedAllocation>(organizational?[]:txIds.filter(key=>!groupedIds.has(key)),batch=>supabase.from('transaction_allocations').select('transaction_id,lot_id,quantity::text,value_base::text,allocation_method').eq('user_id',user.id).in('transaction_id',batch)),
  readLinked<{id:string;entity_id:string;created_at:string;new_data:{sale_amount?:number;unit_price?:number}|null}>(organizational?[]:transactions.filter(tx=>tx.metadata?.sale_price_amendment).map(tx=>tx.id),
   batch=>supabase.from('audit_logs').select('id,entity_id,created_at,new_data').eq('user_id',user.id).eq('action','AMEND_PERSONAL_SALE_PRICE').in('entity_id',batch)),
 ]);

 const allocationRows=[...allocations,...lotLines.filter(line=>groupedIds.has(line.transaction_id))];
 const statement=buildAssetStatement({asOf:options.asOf,baseCurrency,organizational,transactions,lots,commands,
  events,reversals,allocations:allocationRows,
  amendments:amendments.map(change=>{
   const portion=groupedIds.has(change.entity_id)?transactions.find(tx=>tx.id===change.entity_id):null;
   if(!portion||change.new_data?.unit_price==null)return change;
   return {...change,new_data:{...change.new_data,sale_amount:new Decimal(portion.quantity).mul(change.new_data.unit_price).toString()}};
  })});
 const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'});
 const today=dateFormat.format(new Date());
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
 // Use one reconciliation pass for the whole report, including all pages.
 if(options.view==='report'&&statement.rows.length>READ_LIMIT)throw Error('ASSET_STATEMENT_LIMIT');
 const postedSales=statement.rows.filter(row=>row.type==='SALE'&&['ACTUAL','RECORDED','UNVERIFIED'].includes(row.status));
 const realized=postedSales.every(row=>row.sale?.realized!=null)
  ?postedSales.reduce((sum,row)=>sum.add(row.sale!.realized!),new Decimal(0)).toString():null;
 const page=options.view==='report'?statement.rows:statement.rows.slice(options.offset,options.offset+options.limit);
 const postedSaleIds=new Set(postedSales.map(row=>row.source_id));
 const allocationMethods=[...new Set(allocationRows.filter(line=>postedSaleIds.has(line.transaction_id))
  .map(line=>line.allocation_method).filter(Boolean))];
 const impactSales=options.impact==='1'&&!organizational?page.filter(row=>postedSaleIds.has(row.source_id)&&row.sale?.proceeds!=null):[];
 const receipts=await readLinked<SaleReceipt>(impactSales.map(row=>row.source_id),batch=>scope(supabase.from('transactions')
  .select('id,asset_account_id,base_value::text,base_currency,metadata'))
  .eq('transaction_type','ADD').eq('metadata->>source','sale_proceeds').in('metadata->>sale_transaction_id',batch));
 const receiptLots=await readLinked<ReceiptLot>(receipts.map(row=>row.id),batch=>scope(supabase.from('lots')
  .select('source_transaction_id,asset_account_id,hawl_start_date,hawl_continuity_source_lot_id')).in('source_transaction_id',batch));
 const destinationIds=[...new Set(receipts.map(row=>row.asset_account_id))];
 const destinations=await readLinked<{id:string;name:string}>(destinationIds,batch=>scope(supabase.from('asset_accounts')
  .select('id,name')).in('asset_type',['CASH','BANK']).in('id',batch));
 const txById=new Map(transactions.map(tx=>[tx.id,tx]));
 const lotsById=new Map(lots.map(lot=>[lot.id,lot]));
 const amendedAfterCutoff=new Set(amendments.filter(change=>dateFormat.format(new Date(change.created_at))>options.asOf).map(change=>change.entity_id));
 const cashImpact=new Map<string, Awaited<ReturnType<typeof saleImpact>>>();
 async function saleImpact(row:typeof impactSales[number]){
  const destination=txById.get(row.source_id)?.metadata?.proceeds_account_id;
  const linked=receipts.filter(receipt=>receipt.metadata.sale_transaction_id===row.source_id&&
   !receipt.metadata.asset_deleted&&receipt.asset_account_id===destination&&receipt.base_currency===baseCurrency&&
   (groupedIds.has(row.source_id)?new Decimal(receipt.base_value).gte(row.sale!.proceeds!):new Decimal(receipt.base_value).eq(row.sale!.proceeds!)));
  const receipt=linked.length===1?linked[0]:undefined;
  const account=destinations.find(item=>item.id===destination);
  const recordedLots=receiptLots.filter(lot=>lot.source_transaction_id===receipt?.id&&lot.asset_account_id===destination);
  const sourceIds=new Set(allocationRows.filter(line=>line.transaction_id===row.source_id&&lotsById.has(line.lot_id)).map(line=>line.lot_id));
  const sourceHawlDates=[...new Set([...sourceIds].flatMap(id=>{const date=lotsById.get(id)?.hawl_start_date;return date?[date]:[];}))].sort();
  const legacyDates=recordedLots.flatMap(lot=>
   lot.hawl_continuity_source_lot_id&&sourceIds.has(lot.hawl_continuity_source_lot_id)&&lot.hawl_start_date?[lot.hawl_start_date]:[]);
  if(!receipt||!account)return {sourceHawlDates,receipt:null};

  // The source RPC is available only once the gold receipt migrations are installed.
  let evidence:RecordedGoldSource[]=[];
  // The live receipt reader returns the latest amount, including later price corrections.
  if(goldAsset&&!amendedAfterCutoff.has(row.source_id)){
   const result=await supabase.rpc('personal_gold_receipt_hawl_sources',{p_receipt_id:receipt.id});
   if(result.error&&result.error.code!=='PGRST202')throw result.error;
   evidence=result.data??[];
  }
  const sources=evidence.filter(part=>!part.reversed&&part.base_currency===baseCurrency&&sourceIds.has(part.source_lot_id))
   .map(part=>({
    lotId:part.source_lot_id,
    acquiredOn:lotsById.get(part.source_lot_id)!.acquisition_date,
    quantity:String(part.sold_quantity),
    proceeds:String(part.proceeds_base),
    inheritedHawlStart:part.inherited_hawl_start_date,
   }));
  const inheritedHawlDates=[...new Set(evidence.length
   ?sources.flatMap(part=>part.inheritedHawlStart?[part.inheritedHawlStart]:[])
   :legacyDates)].sort();
  return {sourceHawlDates,receipt:{account:account.name,inheritedHawlDates,sources}};
 }
 for(let start=0;start<impactSales.length;start+=8){
  const page=impactSales.slice(start,start+8);
  const results=await Promise.all(page.map(saleImpact));
  page.forEach((sale,index)=>cashImpact.set(sale.source_id,results[index]));
 }
 const numbered=await withVoucherNumbers(supabase,page.map(row=>({...row,document_sequence:undefined as string|undefined,document_links:undefined as Record<string,string>|undefined})));
 return {
  asset:{id:asset.id,name:asset.name,unit:asset.unit,type:asset.asset_type,organizational,metalGrade:metalGrade==null?null:String(metalGrade)},
  valuation,averageCost,realized,allocationMethod:allocationMethods.length===1?allocationMethods[0]:null,current:options.asOf===today,
  asOf:options.asOf,baseCurrency,complete,incompleteRows:statement.incompleteRows,
  reconciliation:current?(reconciled?'MATCHED':'UNRECONCILED'):'HISTORICAL',
  closing:complete?statement.closing:{quantity:null,cost:null,currency:baseCurrency},
  rows:numbered.map(row=>({...row,
   grouped:groupedIds.has(row.source_id)&&row.type==='SALE'?(()=>{
    const tx=transactions.find(item=>item.id===row.source_id);
    const metadata=tx?.metadata as {lot_selection?:{method?:string};sale_price_amendment?:{revision?:number}}|null;
    return {method:metadata?.lot_selection?.method,revision:metadata?.sale_price_amendment?.revision??0};
   })():null,
   ...(options.impact==='1'?{cashImpact:cashImpact.get(row.source_id)??null}:{}),
   remainingQuantity:missingSource||current&&!reconciled?null:row.remainingQuantity,
   remainingCost:missingSource||current&&!reconciled?null:row.remainingCost,
   voucher:row.document_sequence??row.document_links?.source_id??null,
  })),
  total:statement.rows.length,
  nextOffset:options.view!=='report'&&options.offset+options.limit<statement.rows.length?options.offset+options.limit:null,
 };
}
