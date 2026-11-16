import {z} from 'zod';
import {requireUser} from './auth';
import {assertOpeningWorkspace} from './financial-opening-workspace';

const uuid=z.string().uuid();
const code=z.string().regex(/^[0-9]{6}([0-9]{2}){0,2}$/);
const parent=z.string().regex(/^[0-9]{4}([0-9]{2}){0,2}$/);
const command=z.object({
 organization:uuid,code,parentCode:parent,
 nameAr:z.string().trim().min(2).max(160),nameEn:z.string().trim().min(2).max(160),
 normalSide:z.enum(['DEBIT','CREDIT']),isPostable:z.boolean(),isActive:z.boolean(),
 expectedVersion:z.number().int().min(0),reason:z.string().trim().min(3).max(1000),
}).strict();

function unwrap<T>(response:{data:T;error:{message:string}|null}):T{
 if(response.error)throw Error(response.error.message.match(/CHART_[A-Z_]+/)?.[0]??'CHART_UNAVAILABLE');
 return response.data;
}

export async function financialChartWorkspace(organization:unknown){
 assertOpeningWorkspace();const org=uuid.parse(organization);const {supabase}=await requireUser();
 return unwrap(await supabase.rpc('financial_chart_workspace',{p_org:org}));
}

export async function saveFinancialChartAccount(input:unknown){
 assertOpeningWorkspace();const p=command.parse(input);const {supabase}=await requireUser();
 return unwrap(await supabase.rpc('save_financial_chart_account',{
  p_org:p.organization,p_code:p.code,p_parent:p.parentCode,
  p_name_ar:p.nameAr,p_name_en:p.nameEn,p_normal_side:p.normalSide,
  p_is_postable:p.isPostable,p_is_active:p.isActive,
  p_expected_version:p.expectedVersion,p_reason:p.reason,
 }));
}
