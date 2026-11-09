import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/services/auth';
import { isSubscriptionSameOrigin } from '@/lib/subscriptions/security';
import { subscriptionError } from '@/lib/subscriptions/model';
import { moduleKey } from '@/lib/subscriptions/bundles';
const input = z.discriminatedUnion('action',[
 z.object({action:z.literal('submit'),organization_id:z.uuid(),token:z.uuid(),modules:z.array(z.object({key:moduleKey,revision:z.number().int().positive()}).strict()).min(2).max(7),interval:z.enum(['monthly','yearly']),phone:z.string().trim().max(50),notes:z.string().trim().max(2000)}).strict(),
 z.object({action:z.enum(['accept','cancel']),organization_id:z.uuid(),id:z.uuid(),revision:z.number().int().positive()}).strict(),
]);
const json=(data:unknown)=>NextResponse.json(data,{headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request){try{
 const id=z.uuid().parse(new URL(request.url).searchParams.get('organization_id'));
 const {supabase}=await requireUser();
 const [catalog,requests,subscription]=await Promise.all([supabase.rpc('subscription_bundle_catalog'),supabase.rpc('subscription_bundle_requests',{p_organization_id:id}),supabase.rpc('organization_subscription',{p_organization_id:id})]);
 if(catalog.error)throw catalog.error;if(requests.error)throw requests.error;if(subscription.error)throw subscription.error;
 return json({modules:catalog.data,...requests.data,max_users:Math.max(1,subscription.data.max_users??1,subscription.data.active_users??1)});
}catch(e){const v=subscriptionError(e);return NextResponse.json({error:v.error},{status:v.status});}}
export async function POST(request:Request){
 if(!isSubscriptionSameOrigin(request))return NextResponse.json({error:'FORBIDDEN'},{status:403});
 try{const {action,organization_id,...details}=input.parse(await request.json());const {supabase}=await requireUser();
 const {data,error}=await supabase.rpc('subscription_bundle_requests',{p_organization_id:organization_id,p_action:action,p_details:details});if(error)throw error;return json(data);
 }catch(e){const v=subscriptionError(e);return NextResponse.json({error:v.error},{status:v.status});}
}
