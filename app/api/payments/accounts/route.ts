import {NextResponse} from 'next/server';
import {requireUser} from '@/services/auth';
async function all(query:()=>any){const rows:any[]=[];for(let i=0;i<50000;i+=500){const r=await query().order('id').range(i,i+499);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<500)return rows;}throw Error('REPORT_TOO_LARGE');}
export async function GET(){try{
 const {supabase,user}=await requireUser();
 const {data:profile,error:pe}=await supabase.from('profiles').select('base_currency').eq('id',user.id).single();if(pe)throw pe;
 const accounts=await all(()=>supabase.from('asset_accounts').select('id,name,currency,asset_type').eq('user_id',user.id).eq('ownership_scope','PERSONAL').is('organization_id',null).eq('status','ACTIVE').in('currency',[profile.base_currency,'USD']).in('asset_type',['BANK','CASH']).or('metadata->>archived.is.null,metadata->>archived.neq.true'));
 const lots:any[]=[];
 for(let i=0;i<accounts.length;i+=150)lots.push(...await all(()=>supabase.from('lots').select('id,asset_account_id,remaining_value_base,remaining_quantity,source_transaction_id').eq('user_id',user.id).in('asset_account_id',accounts.slice(i,i+150).map(a=>a.id)).gt('remaining_quantity',0)));
 const txIds=[...new Set(lots.map(l=>l.source_transaction_id).filter(Boolean))];const txs:any[]=[];for(let i=0;i<txIds.length;i+=150)txs.push(...await all(()=>supabase.from('transactions').select('id,quantity,gross_value,currency').eq('user_id',user.id).in('id',txIds.slice(i,i+150))));const txMap=new Map(txs.map(t=>[t.id,t])),accountMap=new Map(accounts.map(a=>[a.id,a]));const native=new Map<string,number>(),unknown=new Set<string>();for(const l of lots){const tx=txMap.get(l.source_transaction_id),account=accountMap.get(l.asset_account_id);if(!tx||!(Number(tx.quantity)>0)||!(Number(tx.gross_value)>0)||tx.currency!==account?.currency){unknown.add(l.asset_account_id);continue;}native.set(l.asset_account_id,(native.get(l.asset_account_id)??0)+Number(l.remaining_quantity)*Number(tx.gross_value)/Number(tx.quantity));}
 const balances=new Map<string,number>();for(const l of lots)balances.set(l.asset_account_id,(balances.get(l.asset_account_id)??0)+Number(l.remaining_value_base??0));
 return NextResponse.json({baseCurrency:profile.base_currency,accounts:accounts.map(a=>({id:a.id,name:a.name,currency:a.currency,type:a.asset_type,balance:unknown.has(a.id)?null:native.get(a.id)??0,book_balance:balances.get(a.id)??0}))},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'PAYMENT_ACCOUNTS_UNAVAILABLE'},{status:400})}}
