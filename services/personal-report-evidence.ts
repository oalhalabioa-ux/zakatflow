import {requireUser} from './auth';
import {personalHistoricalValuation,personalReportEvidence,type PersonalHistoricalValuation} from '../lib/personal-report-evidence';
import type {RegisterData} from '../lib/financial-register';
import {readAssetStatement} from './asset-statement';

export async function readPersonalReportEvidence(register:RegisterData,to:string){
 const {supabase,user}=await requireUser();
 async function all<T>(read:(first:number,last:number)=>PromiseLike<{data:T[]|null;error:unknown}>){
  const rows:T[]=[];
  for(let offset=0;;offset+=500){
   const {data,error}=await read(offset,offset+499);
   if(error||!data)throw Error('PERSONAL_REPORT_EVIDENCE_UNAVAILABLE');
   rows.push(...data);
   if(data.length<500)return rows;
  }
 }
 const [contracts,movements,funding,transactions,payables,investments]=await Promise.all([
  all((a,b)=>supabase.from('personal_contracts').select('id,product,side,status,currency').eq('user_id',user.id).order('id').range(a,b)),
  all((a,b)=>supabase.from('personal_contract_movements').select('id,contract_id,request_id,kind,amount,operation_date,asset_id,payable_id,transaction_ids,reversed_at,reversal_date')
   .eq('user_id',user.id).lte('operation_date',to).order('id').range(a,b)),
  all((a,b)=>supabase.from('personal_financings').select('cash_transaction_id,kind,side').eq('user_id',user.id).order('id').range(a,b)),
  all((a,b)=>supabase.from('transactions').select('id,asset_account_id,transaction_type,transaction_date,currency,gross_value,quantity,base_currency,base_value,metadata')
   .eq('user_id',user.id).is('organization_id',null).lte('transaction_date',to).order('id').range(a,b)),
  all((a,b)=>supabase.from('personal_payables').select('id,request_id,amount,currency,event_date').eq('user_id',user.id).lte('event_date',to).order('id').range(a,b)),
  all((a,b)=>supabase.from('investment_operations').select('id,contract_id,organization_id,status,kind,account_id,operation_date,amount,exchange_rate')
   .eq('user_id',user.id).is('organization_id',null).eq('status','POSTED').lte('operation_date',to).order('id').range(a,b)),
 ]);
 const evidence=personalReportEvidence(register,{contracts,movements,funding,transactions,payables,investments});
 if(to===register.asOf)return evidence;
 const candidates=await all((a,b)=>supabase.from('asset_accounts').select('id,name,asset_type,currency,metadata')
  .eq('user_id',user.id).eq('ownership_scope','PERSONAL').is('organization_id',null).eq('metadata->>market_valuation_date',to).order('id').range(a,b));
 const assets=candidates.filter(a=>!['BANK','CASH','RECEIVABLE'].includes(a.asset_type)&&a.metadata?.market_price_currency===register.baseCurrency&&
  !a.metadata.archived&&a.metadata.market_value_auto!==true&&a.metadata.market_price_source!=='ACQUISITION_COST'&&
  !a.metadata.investment_id&&!a.metadata.personal_contract_id&&!a.metadata.register_source);
 const assetValuations:PersonalHistoricalValuation[]=[];
 for(let offset=0;offset<assets.length;offset+=6){
  const values=await Promise.allSettled(assets.slice(offset,offset+6).map(async asset=>{
   const statement=await readAssetStatement(asset.id,{asOf:to,offset:0,limit:1});
   const current=await supabase.from('asset_accounts').select('id,name,asset_type,currency,metadata')
    .eq('id',asset.id).eq('user_id',user.id).eq('ownership_scope','PERSONAL').is('organization_id',null).maybeSingle();
   if(current.error||!current.data||JSON.stringify(current.data)!==JSON.stringify(asset))return null;
   return personalHistoricalValuation(asset,statement,to);
  }));
  for(const row of values){
   if(row.status==='fulfilled'&&row.value)assetValuations.push(row.value);
   else evidence.issues.push('PERSONAL_HISTORICAL_ASSET_EVIDENCE_UNRECONCILED');
  }
 }
 return {...evidence,assetValuations};
}
