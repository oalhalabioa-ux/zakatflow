import Decimal from 'decimal.js';

const Money=Decimal.clone({precision:50});
type BookAccount={id:string;kind:string;balance:string;cash?:boolean};
type RecognizedItem={id:string;kind:'ASSET'|'LIABILITY';recognizedAmount:string};

/** Align all nonzero book balances to approved acquisition-date items.
 * Newly recognized amounts can use a verified existing zero-balance account.
 * Account IDs are scoped by the caller to the subsidiary's dated ledger. */
export function acquisitionFairValueDifferences(
 accounts:readonly BookAccount[],items:readonly RecognizedItem[],taxBasisDocumented:boolean,
){
 const balances=new Map(accounts.filter(a=>a.kind==='ASSET'||a.kind==='LIABILITY').map(a=>[a.id,a]));
 const adjustments:Array<{accountId:string;kind:RecognizedItem['kind'];bookValue:string;recognizedValue:string;adjustment:string}>=[];
 for(const item of items){
  const account=balances.get(item.id);
  if(!account||account.kind!==item.kind)return {status:'FAIR_VALUE_MAPPING_REQUIRED' as const};
  const book=new Money(account.balance).times(item.kind==='ASSET'?1:-1);
  const delta=new Money(item.recognizedAmount).minus(book);
  balances.delete(item.id);
  if(delta.isZero())continue;
  if(account.cash||book.lt(0))return {status:'FAIR_VALUE_ACCOUNT_UNSUPPORTED' as const};
  adjustments.push({accountId:account.id,kind:item.kind,bookValue:book.toFixed(4),
   recognizedValue:new Money(item.recognizedAmount).toFixed(4),adjustment:delta.toFixed(4)});
 }
 if([...balances.values()].some(account=>!new Money(account.balance).isZero()))
  return {status:'FAIR_VALUE_MAPPING_REQUIRED' as const};
 if(adjustments.length&&!taxBasisDocumented)return {status:'FAIR_VALUE_TAX_BASIS_REQUIRED' as const};
 return {status:'ELIGIBLE' as const,adjustments};
}
