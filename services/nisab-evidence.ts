import Decimal from 'decimal.js';
import {requireUser} from './auth';
import {firstNisab,type Movement,type Quote,type Standard} from '@/lib/first-nisab';

export async function nisabEvidence(standard:Standard) {
 if(!['GOLD','SILVER'].includes(standard)) throw Error('INVALID_NISAB_STANDARD');
 const {supabase,user}=await requireUser();
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Riyadh'});
 const {data:profile,error}=await supabase.from('profiles').select('base_currency').eq('id',user.id).single();
 if(error) throw error;
 const scope='asset_accounts!inner(asset_type,currency,unit,is_zakatable,metadata,ownership_scope)';
 // A full statement may exceed PostgREST's row limit. Keep deterministic pages
 // and reject changing counts or duplicated IDs while gathering evidence.
 async function collect(query:any) {
   const rows:any[]=[];
   const seen=new Set<string>();
   let total:number|undefined;
   do {
     const {data,count,error}=await query.range(rows.length,rows.length+499);
     if(error) throw error;
     if(count==null || (total!=null && count!==total) || (!data.length && rows.length<count)) return null;
     total=count;
     for(const row of data){if(seen.has(row.id))return null;seen.add(row.id);rows.push(row);}
   }while(rows.length<total!);
   return rows;
 }
 const [ledger,inventory]=await Promise.all([
   collect(supabase.from('transactions').select('id,transaction_date,transaction_type,quantity,asset_account_id,'+scope,{count:'exact'}).eq('user_id',user.id).is('organization_id',null).eq('asset_accounts.ownership_scope','PERSONAL').eq('asset_accounts.is_zakatable',true).order('transaction_date').order('id')),
   collect(supabase.from('lots').select('id,asset_account_id,remaining_quantity,'+scope,{count:'exact'}).eq('user_id',user.id).is('organization_id',null).eq('asset_accounts.ownership_scope','PERSONAL').eq('asset_accounts.is_zakatable',true).order('id'))
 ]);
 const review=(reason:string)=>({status:'REVIEW' as const,reason});
 if(!ledger||!inventory) return review('INCOMPLETE_LEDGER');
 const net=new Map<string,Decimal>(), moves:Movement[]=[];
 for(const row of ledger) {
   const a=row.asset_accounts, type=a.asset_type;
   const metal=type==='GOLD'||type==='SILVER';
   if(metal ? a.unit!=='g' : !['CASH','BANK'].includes(type)||a.currency!==profile.base_currency) return review('HISTORICAL_VALUATION_REQUIRED');
   const incoming=['PURCHASE','ADD','TRANSFER_IN'].includes(row.transaction_type);
   if(!incoming&&!['SALE','TRANSFER_OUT','WITHDRAWAL','ZAKAT_PAYMENT'].includes(row.transaction_type)) return review('MOVEMENT_REVIEW_REQUIRED');
   if(row.transaction_date>today) return review('FUTURE_MOVEMENT');
   const units=new Decimal(row.quantity).times(incoming?1:-1);
   net.set(row.asset_account_id,(net.get(row.asset_account_id)??new Decimal(0)).plus(units));
   const purity=type==='GOLD'?new Decimal(a.metadata?.karat??24).div(24):type==='SILVER'?new Decimal(a.metadata?.purity??a.metadata?.karat??999):new Decimal(1);
   const factor=type==='SILVER'&&purity.gt(1)?purity.div(1000):purity;
   if(!factor.gt(0)||factor.gt(1)) return review('PURITY_REQUIRED');
   moves.push({id:row.id,date:row.transaction_date,asset:metal?type:'CASH',units:units.times(factor).toString()});
 }
 for(const lot of inventory) net.set(lot.asset_account_id,(net.get(lot.asset_account_id)??new Decimal(0)).minus(lot.remaining_quantity));
 if([...net.values()].some(q=>!q.isZero())) return review('UNRECONCILED_BALANCE');
 if(!moves.length) return {status:'BELOW' as const};
 const prices=await collect(supabase.from('market_prices').select('id,valuation_date,asset_type,currency,instrument_code,karat,price_per_unit,source',{count:'exact'})
   .eq('currency',profile.base_currency).in('asset_type',['GOLD','SILVER']).gte('valuation_date',moves[0].date).lte('valuation_date',today).order('id'));
 if(!prices) return review('INCOMPLETE_PRICE_HISTORY');
 const quotes:Quote[]=prices.filter(p=>(!p.instrument_code||p.instrument_code===(p.asset_type==='GOLD'?'XAU':'XAG'))&&
   (p.karat==null||(p.asset_type==='GOLD'&&Number(p.karat)===24))&&p.source).map(p=>({id:p.id,date:p.valuation_date,asset:p.asset_type as Standard,source:p.source,price:String(p.price_per_unit)}));
 return firstNisab(moves,quotes,standard,today);
}
