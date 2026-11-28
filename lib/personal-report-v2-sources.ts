import Decimal from 'decimal.js';
import {z} from 'zod';
import type {RegisterData} from './financial-register';
import type {PersonalReportEvidence} from './personal-report-evidence';
import {projectClassifiedPersonalActivity} from './personal-source-contracts';

type Classified = ReturnType<typeof projectClassifiedPersonalActivity>;

export function reconcilePersonalClassification(register:RegisterData,evidence:PersonalReportEvidence,
 classified:Classified,period:{from:string;to:string}){
 const cashById=new Map(register.cashMovements.map(row=>[row.id,row]));
 const personalCashIds=new Set(register.accounts.filter(account=>account.organizationId===null&&account.entityId===null).map(account=>account.id));
 const rows=classified.rows.filter(row=>{
  const movement=cashById.get(row.transaction_id);
  const amount=new Decimal(row.base_amount).times(row.kind==='INCOME'?1:-1);
  const kind=row.is_reversal?'REVERSAL':row.kind==='INCOME'?'ADD':'WITHDRAWAL';
  if(!movement||!personalCashIds.has(movement.accountId)||row.entry_date<period.from||row.entry_date>period.to||
   movement.source!=='ASSETS'||movement.transactionType!==kind||!amount.eq(movement.amount)||movement.date!==row.entry_date||
   movement.currency!==row.base_currency||movement.internalTransferId||movement.purchaseFunding||evidence.cash.has(movement.id))return false;
  evidence.cash.set(movement.id,'OPERATING');return true;
 });
 if(rows.length!==classified.rows.length)evidence.issues.push('PERSONAL_CLASSIFIED_CASH_RECONCILIATION_REQUIRED');
 return {...projectClassifiedPersonalActivity(rows),...period};
}

const cutoff=z.object({scope:z.literal('PERSONAL'),asOf:z.string().date(),basis:z.literal('NATIVE_V2_MOVEMENTS'),
 coverage:z.literal('PARTIAL'),rows:z.array(z.object({id:z.string().uuid(),source:z.enum(['PERSONAL_RECEIVABLE','PERSONAL_PAYABLE']),
  side:z.enum(['RECEIVABLE','PAYABLE']),currency:z.string().regex(/^[A-Z]{3}$/),
  balance:z.string().regex(/^\d+(\.\d+)?$/).nullable(),gap:z.string().nullable()})),excludedSources:z.array(z.string())});

export function personalCutoffEvidence(value:unknown,asOf:string){
 const result=cutoff.parse(value);
 if(result.asOf!==asOf||new Set(result.rows.map(row=>row.id)).size!==result.rows.length||
  result.rows.some(row=>(row.balance===null)!==(row.gap!==null)||(row.side==='PAYABLE')!==(row.source==='PERSONAL_PAYABLE')))
  throw Error('PERSONAL_CUTOFF_SOURCE_INVALID');
 return result;
}
