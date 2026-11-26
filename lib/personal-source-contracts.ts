import Decimal from 'decimal.js';
import {z} from 'zod';

const Amount=Decimal.clone({precision:40});
const signedAmount=z.string().regex(/^-?\d{1,16}(\.\d{1,8})?$/);
const currency=z.string().regex(/^[A-Z]{3}$/);
const document=z.object({
 document_id:z.string().uuid(),transaction_id:z.string().uuid(),
 kind:z.enum(['INCOME','EXPENSE']),category_code:z.string(),description:z.string(),entry_date:z.string().date(),
 amount:signedAmount,currency,base_amount:signedAmount,base_currency:currency,is_reversal:z.boolean(),
});

export function projectClassifiedPersonalActivity(raw:unknown){
 const rows=z.array(document).parse(raw);
 const totals=new Map<string,{income:Decimal;expense:Decimal}>();
 const seen=new Set<string>();
 for(const row of rows){
  const amount=new Amount(row.base_amount);
  if(seen.has(row.transaction_id)||(row.is_reversal?!amount.lt(0):!amount.gt(0)))
   throw Error('PERSONAL_CLASSIFICATION_SOURCE_INVALID');
  seen.add(row.transaction_id);
  const group=totals.get(row.base_currency)??{income:new Amount(0),expense:new Amount(0)};
  if(row.kind==='INCOME')group.income=group.income.plus(amount);else group.expense=group.expense.plus(amount);
  totals.set(row.base_currency,group);
 }
 return {
  basis:'EXPLICIT_PERSONAL_DOCUMENTS' as const,
  coverage:'CLASSIFIED_SUBSET' as const,
  rows,
  totals:[...totals.entries()].sort(([a],[b])=>a.localeCompare(b))
    .map(([currency,{income,expense}])=>({currency,income:income.toString(),expense:expense.toString(),net:income.minus(expense).toString()})),
 };
}
