import DecimalJs from 'decimal.js';
const Decimal=DecimalJs.clone({precision:40});

type Numeric = string | number;
type State = {id:string; quantity:Numeric; value:Numeric; after_quantity:Numeric; after_value:Numeric};
export type StatementTransaction = {
 id:string; transaction_date:string; created_at:string; transaction_type:string; quantity:Numeric;
 unit_price:Numeric|null; gross_value:Numeric; currency:string; base_value:Numeric; base_currency:string;
 reversal_of_transaction_id:string|null; reference:string|null;
 metadata:Record<string,unknown>|null;
};
export type StatementLot = {
 source_transaction_id:string; original_quantity:Numeric; original_value_base:Numeric;
 remaining_quantity:Numeric; remaining_value_base:Numeric; acquisition_date:string;
 metadata:Record<string,unknown>|null;
};
export type StatementAllocation = {transaction_id:string; quantity:Numeric; value_base:Numeric};
export type StatementCommand = {
 id:string; transaction_id:string|null; financial_event_id:string|null; operation:string;
 operation_date:string; created_at:string; applied_at:string|null;
 quantity:Numeric; amount:Numeric; lot_states:State[]|null;
};
type Event = {id:string; status:string; base_currency:string};
type Reversal = {id:string; event_id:string; changed_at:string};
type Amendment = {id:string; entity_id:string; created_at:string; new_data:{sale_amount?:Numeric; unit_price?:Numeric}|null};
type Input = {
 asOf:string; baseCurrency:string; organizational:boolean; transactions:StatementTransaction[];
 lots:StatementLot[]; allocations:StatementAllocation[]; commands:StatementCommand[];
 events:Event[]; reversals:Reversal[]; amendments:Amendment[];
};

type Effect = {quantity:DecimalJs; cost:DecimalJs};
const zero=():Effect=>({quantity:new Decimal(0),cost:new Decimal(0)});
const effectiveDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'});
function riyadhDate(timestamp:string){
 const parts=effectiveDate.formatToParts(new Date(timestamp));
 return ['year','month','day'].map(part=>parts.find(item=>item.type===part)?.value).join('-');
}
function indexBy<T>(items:T[],key:(item:T)=>string){
 const result=new Map<string,T[]>();
 for(const item of items){const id=key(item);const group=result.get(id);if(group)group.push(item);else result.set(id,[item]);}
 return result;
}

const incoming=new Set(['OPENING_BALANCE','ADD','PURCHASE','TRANSFER_IN','ADJUSTMENT_IN']);
const outgoing=new Set(['SALE','DISPOSAL','WITHDRAWAL','TRANSFER_OUT','ADJUSTMENT_OUT','ZAKAT_PAYMENT']);
const pending=new Set(['DRAFT','PLANNED','COMMITTED','CANCELLED','REJECTED']);

export function buildAssetStatement(input:Input){
 const {asOf,baseCurrency,transactions,lots,allocations,commands,events,reversals,amendments}=input;
 const byTx=new Map(transactions.map(tx=>[tx.id,tx]));
 const applied=new Map(commands.filter(cmd=>cmd.transaction_id).map(cmd=>[cmd.transaction_id,cmd]));
 const eventById=new Map(events.map(event=>[event.id,event]));
 const lotsByTx=indexBy(lots,lot=>lot.source_transaction_id);
 const allocationsByTx=indexBy(allocations,line=>line.transaction_id);
 const reversalsByEvent=indexBy(reversals,row=>row.event_id);
 const visibleReversed=new Set(transactions.filter(tx=>tx.transaction_date<=asOf&&!tx.metadata?.asset_deleted)
  .map(tx=>tx.reversal_of_transaction_id).filter(Boolean));
 const incomplete=new Set<string>();

 function movement(tx:StatementTransaction){
  const metadata=tx.metadata??{};
  if(metadata.operation==='DEPRECIATION'||metadata.operation==='DISPOSAL')return metadata.operation;
  if(metadata.reason==='DISPOSAL_ZERO_VALUE')return 'DISPOSAL';
  if(tx.transaction_type==='ADJUSTMENT'&&['IN','OUT'].includes(String(metadata.adjustment_direction)))return `ADJUSTMENT_${metadata.adjustment_direction}`;
  return tx.transaction_type;
 }

 function effectOf(tx:StatementTransaction):Effect|null{
  const kind=movement(tx);
  const command=applied.get(tx.id);
  if(tx.base_currency!==baseCurrency)return null;
  if(command?.applied_at&&command.lot_states?.length){
   return command.lot_states.reduce((sum,lot)=>({
    quantity:sum.quantity.add(lot.after_quantity).sub(lot.quantity),
    cost:sum.cost.add(lot.after_value).sub(lot.value),
   }),zero());
  }
  if(incoming.has(kind)){
   const source=lotsByTx.get(tx.id);
   if(!source?.length)return null;
   const total=source.reduce((sum,lot)=>({quantity:sum.quantity.add(lot.original_quantity),
    cost:sum.cost.add(lot.original_value_base)}),zero());
   return total.quantity.eq(tx.quantity)?total:null;
  }
  if(kind==='DEPRECIATION'||(outgoing.has(kind)&&input.organizational)){
   const value=tx.metadata?.asset_effect_base;
   return typeof value==='number'||typeof value==='string'
    ?{quantity:kind==='DEPRECIATION'?new Decimal(0):new Decimal(tx.quantity).negated(),cost:new Decimal(value)}:null;
  }
  if(outgoing.has(kind)){
   const lines=allocationsByTx.get(tx.id);
   if(!lines?.length)return null;
   const total=lines.reduce((sum,line)=>({quantity:sum.quantity.sub(line.quantity),
    cost:sum.cost.sub(line.value_base)}),zero());
   return total.quantity.abs().eq(tx.quantity)?total:null;
  }
  return null;
 }

 type Row = {
  id:string; source_id:string; source_path:'transactions'|'asset_event'|'audit'; date:string; createdAt:string;
  type:string; status:string; reference:string|null; currency:string|null; exchangeRate:string|null;
  amount:string|null; unitPrice:string|null; quantityIn:string|null; quantityOut:string|null; costEffect:string|null;
 };
 const entries:{row:Row; effect:Effect|null}[]=[];
 function add(row:Row,effect:Effect|null){
  if(row.date>asOf)return;
  if(!effect)incomplete.add(row.id);
  entries.push({row:{...row,quantityIn:effect?Decimal.max(effect.quantity,0).toString():null,
   quantityOut:effect?Decimal.max(effect.quantity.negated(),0).toString():null,costEffect:effect?.cost.toString()??null},effect});
 }

 for(const tx of transactions){
  if(tx.metadata?.asset_deleted||tx.transaction_date>asOf)continue;
  const source=tx.reversal_of_transaction_id?byTx.get(tx.reversal_of_transaction_id):null;
  const eventId=typeof tx.metadata?.financial_event_id==='string'?tx.metadata.financial_event_id:null;
  const event=eventId?eventById.get(eventId):undefined;
  const command=applied.get(tx.id);
  const cancellation=eventId?reversalsByEvent.get(eventId)?.at(0):undefined;
  const isReversal=tx.transaction_type==='REVERSAL'||!!tx.reversal_of_transaction_id;
  const cancelled=!!cancellation&&riyadhDate(cancellation.changed_at)<=asOf;
  const original=source?effectOf(source):null;
  const notPosted=!!event&&pending.has(event.status)&&!command?.applied_at;
  let effect=isReversal?(original?{quantity:original.quantity.negated(),cost:original.cost.negated()}:null):notPosted?zero():effectOf(tx);
  if(!notPosted&&input.organizational&&((eventId&&!event&&!command?.applied_at)
    ||(!eventId&&tx.transaction_type==='PURCHASE'&&!isReversal)
    ||(event?.status==='REVERSED'&&!cancellation&&!visibleReversed.has(tx.id))))effect=null;
  const kind=isReversal?'REVERSAL':movement(tx);
  const status=cancelled||visibleReversed.has(tx.id)?'REVERSED':notPosted?event!.status:
   command?.applied_at||event?.status==='ACTUAL'||(event?.status==='REVERSED'&&cancellation)?'ACTUAL':
   !input.organizational?'RECORDED':effect?'RECORDED':'UNVERIFIED';
  const marketAmount=kind==='DISPOSAL'&&tx.metadata?.reason==='DISPOSAL_ZERO_VALUE'
   ?new Decimal(0):new Decimal(tx.gross_value);
  const exchangeRate=tx.metadata?.fx_rate;
  const fallbackPrice=(kind==='SALE'||kind==='PURCHASE')&&new Decimal(tx.quantity).gt(0)
   ?marketAmount.div(tx.quantity).toDecimalPlaces(8).toString():null;
  add({id:tx.id,source_id:tx.id,source_path:'transactions',date:tx.transaction_date,createdAt:tx.created_at,type:kind,
   status,reference:tx.reference,currency:tx.currency,amount:marketAmount.toString(),
   exchangeRate:typeof exchangeRate==='number'||typeof exchangeRate==='string'?String(exchangeRate):tx.currency===tx.base_currency?'1':null,
   unitPrice:tx.unit_price==null?fallbackPrice:String(tx.unit_price),quantityIn:null,quantityOut:null,costEffect:null},effect);
  if(cancellation&&eventId&&!visibleReversed.has(tx.id)&&!isReversal){
   add({id:cancellation.id,source_id:eventId,source_path:'asset_event',date:riyadhDate(cancellation.changed_at),
    createdAt:cancellation.changed_at,type:'REVERSAL',status:'RECORDED',reference:null,
    currency:tx.base_currency,exchangeRate:null,amount:null,unitPrice:null,quantityIn:null,quantityOut:null,costEffect:null},
    effect?{quantity:effect.quantity.negated(),cost:effect.cost.negated()}:null);
  }
 }

 for(const command of commands){
  if(command.transaction_id||command.applied_at)continue;
  const event=command.financial_event_id?eventById.get(command.financial_event_id):undefined;
  const status=event?.status??(command.financial_event_id?'UNVERIFIED':'DRAFT');
  add({id:command.id,source_id:command.id,source_path:'transactions',date:command.operation_date,
   createdAt:command.created_at,type:command.operation,status,reference:null,currency:event?.base_currency??null,
   exchangeRate:null,amount:String(command.amount),unitPrice:null,quantityIn:null,quantityOut:null,costEffect:null},
   status==='ACTUAL'||status==='UNVERIFIED'?null:zero());
 }

 for(const change of amendments){
  const original=byTx.get(change.entity_id);
  if(!original||original.metadata?.asset_deleted)continue;
  add({id:change.id,source_id:original.id,source_path:'audit',date:riyadhDate(change.created_at),
   createdAt:change.created_at,type:'PRICE_CORRECTION',status:'RECORDED',reference:original.reference,
   currency:original.currency,exchangeRate:null,amount:change.new_data?.sale_amount?.toString()??null,
   unitPrice:change.new_data?.unit_price?.toString()??null,quantityIn:null,quantityOut:null,costEffect:null},zero());
 }

 entries.sort((a,b)=>a.row.date.localeCompare(b.row.date)||a.row.createdAt.localeCompare(b.row.createdAt)||a.row.id.localeCompare(b.row.id));
 let running:Effect|null=zero();
 const rows=entries.map(({row,effect})=>{
  running=running&&effect?{quantity:running.quantity.add(effect.quantity),cost:running.cost.add(effect.cost)}:null;
  return {...row,remainingQuantity:running?.quantity.toString()??null,remainingCost:running?.cost.toString()??null};
 });
 const last=rows.at(-1);
 return {rows, complete:incomplete.size===0, incompleteRows:incomplete.size,
  closing:{quantity:last?last.remainingQuantity:'0',cost:last?last.remainingCost:'0',currency:baseCurrency}};
}
