import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function POST(req:Request){
 const secret=req.headers.get('x-cron-secret');
 if(!process.env.CRON_SECRET || secret!==process.env.CRON_SECRET) return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
 const supabase=await supabaseAdmin(); const now=new Date().toISOString();
 const {data:jobs,error}=await supabase.from('notification_jobs').select('*').eq('status','PENDING').lte('scheduled_for',now).limit(100);
 if(error)return NextResponse.json({error:error.message},{status:500}); let sent=0;
 for(const job of jobs??[]){
  const {data:lot}=await supabase.from('lots').select('hawl_due_date').eq('user_id',job.user_id).gt('remaining_quantity',0).order('hawl_due_date',{ascending:true}).limit(1).maybeSingle();
  const {error:e}=await supabase.from('notifications').insert({user_id:job.user_id,type:job.notification_type,title:'ZakatFlow Hawl Reminder',body:lot?`An active lot is approaching Hawl due date: ${lot.hawl_due_date}.`:'Your ZakatFlow Hawl reminder is due.',scheduled_for:job.scheduled_for,metadata:{job_id:job.id}});
  if(e) await supabase.from('notification_jobs').update({status:'FAILED',attempts:job.attempts+1,last_error:e.message}).eq('id',job.id);
  else {await supabase.from('notification_jobs').update({status:'SENT',attempts:job.attempts+1}).eq('id',job.id); sent++;}
 }
 return NextResponse.json({processed:jobs?.length??0,sent});
}
