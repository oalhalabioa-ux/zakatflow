import {isSameOriginRequest} from '../../../../lib/request-origin';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireUser} from '../../../../services/auth';
import {resolveAssetEntryFx} from '../../../../services/asset-entry-fx';
const headers={'Cache-Control':'no-store'};
const change=z.object({name:z.string().trim().min(1).max(200),date:z.string().date(),amount:z.number().finite().positive(),quantity:z.number().finite().positive(),purpose:z.string().max(2000)}).strict();
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('UPDATE'),asset_id:z.string().uuid(),expected_updated_at:z.string().datetime({offset:true}),changes:change}).strict(),
 z.object({action:z.literal('ARCHIVE'),asset_id:z.string().uuid(),expected_updated_at:z.string().datetime({offset:true})}).strict(),
]);
const failure=(e:any)=>{
 const code=e instanceof z.ZodError?'ASSET_OPENING_VALUES_INVALID':/^(ASSET_[A-Z_]+|UNAUTHORIZED|ORIGIN_REQUIRED)$/.test(e.message??'')?e.message:'ASSET_OPENING_REQUEST_FAILED';
 return NextResponse.json({error:code},{status:code==='UNAUTHORIZED'?401:code==='ORIGIN_REQUIRED'||/DENIED/.test(code)?403:code==='ASSET_OPENING_VALUES_INVALID'?400:code==='ASSET_OPENING_REQUEST_FAILED'?500:409,headers});
};
export async function GET(req:Request){try{
 const id=z.string().uuid().parse(new URL(req.url).searchParams.get('asset_id'));
 const{supabase}=await requireUser();const{data,error}=await supabase.rpc('manage_asset_opening',{p_asset_id:id,p_action:'INSPECT'});if(error)throw error;
 return NextResponse.json(data,{headers});
}catch(e){return failure(e);}}
export async function POST(req:Request){try{
 if(!isSameOriginRequest(req))throw Error('ORIGIN_REQUIRED');
 const p=command.parse(await req.json());const{supabase,user}=await requireUser();
 let changes:Record<string,unknown>={};
 if(p.action==='UPDATE'){
  const{data:inspection,error}=await supabase.rpc('manage_asset_opening',{p_asset_id:p.asset_id,p_action:'INSPECT'});if(error)throw error;
  if(!inspection.can_edit)throw Error(inspection.block_reason||'ASSET_OPENING_EDIT_DENIED');
  const a=inspection.asset;const quote=await resolveAssetEntryFx(supabase,user.id,a.currency,p.changes.date,a.organization_id??null);
  changes={...p.changes,fx_rate:quote.rate,fx_rate_id:quote.row?.id??null,fx_rate_date:quote.row?.valuation_date??p.changes.date,fx_rate_source:quote.row?.source??'BASE_CURRENCY'};
 }
 const{data,error}=await supabase.rpc('manage_asset_opening',{p_asset_id:p.asset_id,p_action:p.action,p_expected_updated_at:p.expected_updated_at,p_changes:changes});if(error)throw error;
 return NextResponse.json(data,{headers});
}catch(e){return failure(e);}}
