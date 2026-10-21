import {projectFinancialAssets} from '../lib/financial-asset-projection';
async function rows(make:()=>any,key='id'){const out:any[]=[];for(let offset=0;offset<50000;offset+=500){const r=await make().order(key).range(offset,offset+499);if(r.error)throw r.error;out.push(...r.data);if(r.data.length<500)return out;}throw Error('REPORT_TOO_LARGE');}
export async function financialAssetProjection(supabase:any,organizations:any[]){
 const ids=organizations.map(o=>o.id);if(!ids.length)return [];
 const [accounts,balances,events,parties]=await Promise.all([
 rows(()=>supabase.from('liquidity_accounts').select('id,organization_id,entity_id,name,account_type,currency,current_balance,current_balance_base,active,metadata').in('organization_id',ids).eq('active',true)),
 rows(()=>supabase.from('financial_event_obligation_balances').select('obligation_id,event_id,obligation_type,base_currency,outstanding_base_amount').in('organization_id',ids).eq('obligation_type','RECEIVABLE').gt('outstanding_base_amount',0),'obligation_id'),
 rows(()=>supabase.from('financial_events').select('id,organization_id,entity_id,counterparty_id,event_date,due_date,status,description').in('organization_id',ids).eq('status','ACTUAL')),
 rows(()=>supabase.from('liquidity_counterparties').select('id,organization_id,name').in('organization_id',ids))
 ]);
 return projectFinancialAssets(accounts,balances,events,parties,organizations);
}
