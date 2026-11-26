import Decimal from 'decimal.js';
import type {RegisterData} from './financial-register';
import {assetReportValuation} from './asset-reports';

export type PersonalCashClass='OPERATING'|'INVESTING'|'FINANCING'|'UNCLASSIFIED';
export type PersonalIncomeClass='FINANCE_INCOME'|'FINANCE_EXPENSE'|'PARTICIPATION_INCOME'|'PARTICIPATION_EXPENSE'|'INVESTMENT_INCOME';
export type PersonalHistoricalValuation={id:string;name:string;date:string;currency:string;market:string;cost:string;source:string};
export type PersonalReportEvidence={
 cash:Map<string,Exclude<PersonalCashClass,'UNCLASSIFIED'>>;
 investmentCashIds?:Set<string>;
 assetValuations?:PersonalHistoricalValuation[];
 income:Array<{id:string;date:string;currency:string;amount:string;category:PersonalIncomeClass}>;
 issues:string[];
};
type Contract={id:string;product:string;side:string;status:string;currency:string};
type ContractMovement={id:string;contract_id:string;request_id:string;kind:string;amount:number|string;operation_date:string;
 asset_id:string|null;payable_id:string|null;transaction_ids:string[];reversed_at:string|null;reversal_date:string|null};
type Payable={id:string;request_id:string;amount:number|string;currency:string;event_date:string};
type Funding={cash_transaction_id:string|null;kind:string;side:string};
type InvestmentOperation={id:string;contract_id:string;organization_id:string|null;status:string;kind:string;
 account_id:string;operation_date:string;amount:number|string;exchange_rate:number|string};
type Transaction={id:string;asset_account_id:string;transaction_type:string;transaction_date:string;currency:string;
 gross_value:number|string;quantity:number|string;base_currency:string;base_value:number|string;metadata:Record<string,unknown>|null};

const date=/^\d{4}-\d{2}-\d{2}$/;
const currency=/^[A-Z]{3}$/;
const actualContracts=new Set(['POSTED','CANCELLED']);
const investmentCashType=new Map([['FUND','TRANSFER_OUT'],['REDEEM','TRANSFER_IN'],['INCOME','ADD']]);

/** A dated asset quote and the independently reconciled asset statement at the same cutoff. */
export function personalHistoricalValuation(
 asset:{id:string;name:string;asset_type:string;currency:string;metadata:Record<string,unknown>|null},
 statement:{asOf:string;complete:boolean;asset:{id:string;organizational:boolean};closing:{quantity:string|null;cost:string|null;currency:string}},
 cutoff:string,
):PersonalHistoricalValuation|null{
 const metadata=asset.metadata;
 const {quantity,cost,currency}=statement.closing;
 if(!statement.complete||statement.asset.organizational||statement.asset.id!==asset.id||statement.asOf!==cutoff||!quantity||!cost||
  !new Decimal(quantity).gt(0)||!metadata||metadata.archived||metadata.market_valuation_date!==cutoff||
  metadata.market_price_currency!==currency||metadata.market_value_auto===true)return null;
 const value=assetReportValuation({...asset,current_value_currency:currency,current_quantity:quantity,current_cost_value:cost},cutoff);
 if(!value?.source)return null;
 return{id:asset.id,name:asset.name,date:cutoff,currency,market:value.value,cost,source:value.source};
}

/** Joins owner-scoped records from existing commands using persisted IDs. */
export function personalReportEvidence(data:RegisterData, source:{
 contracts:Contract[];movements:ContractMovement[];funding:Funding[];transactions:Transaction[];payables:Payable[];
 investments:InvestmentOperation[];
}):PersonalReportEvidence{
 const income:PersonalReportEvidence['income']=[],issues=new Set<string>();
 const classified=new Map<string,Exclude<PersonalCashClass,'UNCLASSIFIED'>>();
 const ambiguous=new Set<string>();
 const cashById=new Map(data.cashMovements.map(m=>[m.id,m]));
 const sourceById=new Map(source.transactions.map(t=>[t.id,t]));
 const contracts=new Map(source.contracts.filter(c=>actualContracts.has(c.status)).map(c=>[c.id,c]));
 const payableById=new Map(source.payables.map(p=>[p.id,p]));
 const sourcesSeen=new Set<string>();
 const cashByInvestment=new Map<string,Transaction[]>();
 const investmentCashIds=new Set<string>();
 const use=(id:string,activity:Exclude<PersonalCashClass,'UNCLASSIFIED'>)=>{
  const movement=cashById.get(id),original=sourceById.get(id);
  if(!movement||!original)return;
  if(movement.accountId!==original.asset_account_id||movement.date!==original.transaction_date||
   movement.currency!==original.base_currency||!new Decimal(movement.amount).abs().eq(original.base_value)||movement.isOpening||movement.reversalOfTransactionId){
   issues.add('PERSONAL_CASH_PROVENANCE_UNRECONCILED');return;
  }
  if(classified.has(id)){
   issues.add('PERSONAL_CASH_PROVENANCE_UNRECONCILED');ambiguous.add(id);return;
  }
  classified.set(id,activity);
 };
 for(const row of source.funding){
  if(!row.cash_transaction_id||!['PAYABLE','RECEIVABLE'].includes(row.side))continue;
  if(row.kind==='LOAN')use(row.cash_transaction_id,row.side==='PAYABLE'?'FINANCING':'INVESTING');
  if(row.kind==='ADVANCE')use(row.cash_transaction_id,'OPERATING');
 }
 for(const row of source.movements){
  const contract=contracts.get(row.contract_id);
  if(!contract||!['PAYABLE','RECEIVABLE'].includes(contract.side))continue;
  if(['FUND','SETTLE','SETTLE_CHARGE'].includes(row.kind)){
   for(const id of row.transaction_ids)use(id,contract.side==='PAYABLE'?'FINANCING':'INVESTING');
  }
  const category:PersonalIncomeClass|undefined=
   row.kind==='CHARGE'&&contract.product==='FINANCING'?(contract.side==='RECEIVABLE'?'FINANCE_INCOME':'FINANCE_EXPENSE'):
   row.kind==='PROFIT'&&contract.product==='PARTICIPATION'?(contract.side==='RECEIVABLE'?'PARTICIPATION_INCOME':'PARTICIPATION_EXPENSE'):undefined;
  if(!category)continue;
  const payable=row.payable_id?payableById.get(row.payable_id):undefined;
  const recognized=contract.side==='RECEIVABLE'
   ? Boolean(row.asset_id&&!row.payable_id&&row.transaction_ids.some(id=>{
    const tx=sourceById.get(id);
    return tx?.asset_account_id===row.asset_id&&tx.transaction_date===row.operation_date&&
     tx.transaction_type==='OPENING_BALANCE'&&tx.metadata?.personal_contract_id===contract.id&&
     tx.currency===contract.currency&&tx.base_currency===contract.currency&&new Decimal(tx.base_value).eq(row.amount);
   }))
   : Boolean(payable&&!row.asset_id&&payable.request_id===row.request_id&&payable.event_date===row.operation_date&&
    payable.currency===contract.currency&&new Decimal(payable.amount).eq(row.amount));
  if(!recognized||sourcesSeen.has(row.id)||!currency.test(contract.currency)||!date.test(row.operation_date)||
   !new Decimal(row.amount).gt(0)||(Boolean(row.reversed_at)!==Boolean(row.reversal_date))||
   row.reversal_date&&(!date.test(row.reversal_date)||row.reversal_date<row.operation_date)){
   issues.add('PERSONAL_INCOME_SOURCE_UNRECONCILED');continue;
  }
  sourcesSeen.add(row.id);
  const amount=new Decimal(row.amount);
  income.push({id:row.id,date:row.operation_date,currency:contract.currency,amount:amount.toString(),category});
  if(row.reversal_date)income.push({id:row.id+':reversal',date:row.reversal_date,currency:contract.currency,amount:amount.negated().toString(),category});
 }
 for(const row of source.transactions){
  if(!cashById.has(row.id))continue;
  const investmentOp=row.metadata?.investment_operation_id;
  if(row.metadata?.source==='INVESTMENTS'&&typeof investmentOp==='string'){
   const linked=cashByInvestment.get(investmentOp);
   if(linked)linked.push(row);else cashByInvestment.set(investmentOp,[row]);
  }
  if(row.transaction_type==='WITHDRAWAL'&&row.metadata?.source==='ASSET_PURCHASE'){
   const purchase=sourceById.get(String(row.metadata.purchase_transaction_id));
   if(!purchase||purchase.transaction_type!=='PURCHASE'||purchase.asset_account_id===row.asset_account_id||
    purchase.transaction_date!==row.transaction_date||purchase.metadata?.funding_account_id!==row.asset_account_id)continue;
   if(!new Decimal(row.quantity).eq(row.gross_value)){
    issues.add('PERSONAL_CASH_FUNDING_AMOUNT_MISMATCH');continue;
   }
   use(row.id,'INVESTING');
  }
  if(row.transaction_type==='ADD'&&row.metadata?.source==='sale_proceeds'){
   const sale=sourceById.get(String(row.metadata.sale_transaction_id));
   if(sale?.transaction_type==='SALE'&&sale.transaction_date===row.transaction_date&&sale.asset_account_id!==row.asset_account_id)
    use(row.id,'INVESTING');
  }
 }
 for(const operation of source.investments){
  if(operation.organization_id!==null||operation.status!=='POSTED')continue;
  const candidates=cashByInvestment.get(operation.id)??[];
  const [row]=candidates;
  const storedRate=row?.metadata?.fx_rate;
  if(candidates.length!==1||row.asset_account_id!==operation.account_id||row.metadata?.investment_id!==operation.contract_id||
   row.transaction_type!==investmentCashType.get(operation.kind)||row.transaction_date!==operation.operation_date||
   Math.sign(cashById.get(row.id)!.amount)!==(operation.kind==='FUND'?-1:1)||
   !currency.test(row.currency)||!new Decimal(operation.amount).gt(0)||!new Decimal(row.gross_value).eq(operation.amount)||
   !new Decimal(operation.exchange_rate).gt(0)||typeof storedRate!=='number'||!new Decimal(storedRate).eq(operation.exchange_rate)){
   issues.add('PERSONAL_INVESTMENT_CASH_SOURCE_UNRECONCILED');continue;
  }
  use(row.id,'INVESTING');
  if(classified.has(row.id)&&!ambiguous.has(row.id))investmentCashIds.add(row.id);
  if(operation.kind==='INCOME'&&investmentCashIds.has(row.id)){
   income.push({id:operation.id,date:row.transaction_date,currency:row.currency,
    amount:new Decimal(operation.amount).toString(),category:'INVESTMENT_INCOME'});
  }
 }
 for(const id of ambiguous)classified.delete(id);
 return {cash:classified,investmentCashIds,income,issues:[...issues]};
}
