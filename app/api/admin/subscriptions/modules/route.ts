import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/services/auth';
import { isSubscriptionSameOrigin } from '@/lib/subscriptions/security';
import { subscriptionError } from '@/lib/subscriptions/model';
import { moduleInput } from '@/lib/subscriptions/bundles';
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('save'),module:moduleInput}).strict(),
 z.object({action:z.literal('offer'),id:z.uuid(),revision:z.number().int().positive(),reason:z.string().trim().min(5).max(1000),total:z.number().finite().min(0).max(100000000).refine(n=>Math.abs(n*100-Math.round(n*100))<.000001),max_users:z.number().int().min(1).max(100000)}).strict(),
 z.object({action:z.enum(['activate','reject']),id:z.uuid(),revision:z.number().int().positive(),reason:z.string().trim().min(5).max(1000)}).strict(),
]);
export async function GET(){try{
 const {supabase}=await requireUser();const [catalog,requests]=await Promise.all([supabase.rpc('subscription_bundle_catalog',{p_admin:true}),supabase.rpc('owner_bundle_requests')]);
 if(catalog.error)throw catalog.error;if(requests.error)throw requests.error;
 return NextResponse.json({modules:catalog.data,rows:requests.data},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){const v=subscriptionError(e);return NextResponse.json({error:v.error},{status:v.status});}}
export async function POST(request:Request){
 if(!isSubscriptionSameOrigin(request))return NextResponse.json({error:'FORBIDDEN'},{status:403});
 try{const body=input.parse(await request.json());const {supabase}=await requireUser();
 const result=body.action==='save'?await supabase.rpc('owner_save_bundle_module',{p_details:body.module,p_reason:body.module.reason}):await supabase.rpc('owner_bundle_requests',{p_action:body.action,p_details:body});
 if(result.error)throw result.error;return NextResponse.json(result.data);
 }catch(e){const v=subscriptionError(e);return NextResponse.json({error:v.error},{status:v.status});}
}
