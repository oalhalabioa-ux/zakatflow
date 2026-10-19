import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireUser} from '@/services/auth';
export async function GET(request:Request){try{
 const {supabase,user}=await requireUser();const date=z.string().date().parse(new URL(request.url).searchParams.get('date'));
 const {data:profile,error:pe}=await supabase.from('profiles').select('base_currency').eq('id',user.id).single();if(pe)throw pe;
 const [{data:orgs,error:oe},rates]=await Promise.all([supabase.from('organizations').select('id,name'),(async()=>{const rows:any[]=[];for(let offset=0;offset<50000;offset+=500){const r=await supabase.from('fx_rates').select('id,organization_id,from_currency,to_currency,rate,valuation_date,source').or(`and(from_currency.eq.USD,to_currency.eq.${profile.base_currency}),and(to_currency.eq.USD,from_currency.eq.${profile.base_currency})`).lte('valuation_date',date).gt('rate',0).order('valuation_date',{ascending:false}).order('id',{ascending:false}).range(offset,offset+499);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<500)return rows;}throw Error('FX_REFERENCE_LIMIT_EXCEEDED')})()]);if(oe)throw oe;
 const names=new Map((orgs??[]).map(o=>[o.id,o.name])),latest=new Map<string,any>();for(const r of rates){const key=`${r.organization_id??'GLOBAL'}:${r.from_currency}:${r.to_currency}`;if(!latest.has(key))latest.set(key,{...r,rate:Number(r.rate),organization_name:names.get(r.organization_id)??null});}
 return NextResponse.json({date,rates:[...latest.values()].sort((a,b)=>Number(!!a.organization_id)-Number(!!b.organization_id)||b.valuation_date.localeCompare(a.valuation_date)||b.id.localeCompare(a.id))},{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'PAYMENT_FX_UNAVAILABLE'},{status:400})}}
