import type {StudySupplier} from './engine';

/**
 * Indicative supplier comparison only: identical item labels are NOT proof of
 * technical, delivery, warranty, tax or incoterm equivalence. Quotes never
 * update CAPEX, financial projections or approved purchase decisions.
 */
export interface SupplierComparison {
 item:string;
 quoteCount:number;
 vendorCount:number;
 comparable:boolean;
 lowestOffer:number|null;
 highestOffer:number|null;
 lowestVendors:string[];
 priceSpread:number|null;
 spreadPercent:number|null;
 issues:('SINGLE_VENDOR'|'DUPLICATE_VENDOR')[];
}
export interface SupplierComparisonReport {
 groups:SupplierComparison[];
 incompleteCount:number;
}
const normalize=(text:string)=>text.trim().replace(/\s+/g,' ');
const key=(text:string)=>normalize(text).toLowerCase();
const validAmount=(amount:number)=>Number.isFinite(amount)&&amount>0&&amount<=1_000_000_000_000;

export function compareSupplierQuotes(quotes:readonly StudySupplier[]):SupplierComparisonReport{
 const grouped=new Map<string,{label:string;rows:{vendor:string;offer:number}[]}>();
 let incompleteCount=0;
 for(const quote of quotes){
  // Imported browser drafts can predate schema validation; fail safely on malformed rows.
  if(!quote||typeof quote.item!=='string'||typeof quote.vendor!=='string'||typeof quote.offer!=='number'){
   incompleteCount++;
   continue;
  }
  const item=normalize(quote.item);
  const vendor=normalize(quote.vendor);
  if(!item||!vendor||!validAmount(quote.offer)){
   incompleteCount++;
   continue;
  }
  const itemKey=key(item);
  const group=grouped.get(itemKey)??{label:item,rows:[]};
  group.rows.push({vendor,offer:quote.offer});
  grouped.set(itemKey,group);
 }
 const groups:Array<SupplierComparison>=[];
 for(const group of grouped.values()){
  const vendorKeys=group.rows.map(row=>key(row.vendor));
  const vendorCount=new Set(vendorKeys).size;
  const issues:SupplierComparison['issues']=[];
  if(vendorCount<2)issues.push('SINGLE_VENDOR');
  if(vendorCount!==group.rows.length)issues.push('DUPLICATE_VENDOR');
  const comparable=issues.length===0;
  const offers=group.rows.map(row=>row.offer);
  const low=Math.min(...offers),high=Math.max(...offers);
  groups.push({
   item:group.label,quoteCount:group.rows.length,vendorCount,comparable,
   lowestOffer:comparable?low:null,highestOffer:comparable?high:null,
   lowestVendors:comparable?group.rows.filter(row=>row.offer===low).map(row=>row.vendor):[],
   priceSpread:comparable?high-low:null,
   spreadPercent:comparable?(high-low)/high*100:null,
   issues
  });
 }
 return {groups,incompleteCount};
}
