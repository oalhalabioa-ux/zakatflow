import {assetEntryQuote,type AssetEntryRate} from '@/lib/asset-entry-details';
import {requireOrganizationMember} from './organization-access';
export async function resolveAssetEntryFx(supabase:any,userId:string,currency:string,date:string,organizationId:string|null){
 let base:string;
 if(organizationId){await requireOrganizationMember(supabase,userId,organizationId);const r=await supabase.from('organizations').select('base_currency').eq('id',organizationId).single();if(r.error)throw r.error;base=r.data.base_currency;}
 else{const r=await supabase.from('profiles').select('base_currency').eq('id',userId).single();if(r.error)throw r.error;base=r.data.base_currency||'SAR';}
 const codes=[...new Set([currency,base])];const active=await supabase.from('currencies').select('code').in('code',codes).eq('active',true);if(active.error)throw active.error;if(active.data.length!==codes.length)throw Error('ASSET_CURRENCY_NOT_REGISTERED');
 if(currency===base)return {rate:1,row:null,base_currency:base};
 const query=(id:string|null)=>{let q=supabase.from('fx_rates').select('id,organization_id,from_currency,to_currency,rate,valuation_date,source');q=id?q.eq('organization_id',id):q.is('organization_id',null);return q.or(`and(from_currency.eq.${currency},to_currency.eq.${base}),and(from_currency.eq.${base},to_currency.eq.${currency})`).lte('valuation_date',date).gt('rate',0).order('valuation_date',{ascending:false}).order('id',{ascending:false}).limit(1);};
 const results=await Promise.all([query(null),...(organizationId?[query(organizationId)]:[])]);for(const r of results)if(r.error)throw r.error;
 const quote=assetEntryQuote(results.flatMap(r=>r.data) as AssetEntryRate[],currency,base,date,organizationId);if(!quote)throw Error('ASSET_SAVED_FX_RATE_MISSING');
 return {...quote,base_currency:base};
}
