import {createHash} from 'node:crypto';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {statementQuery} from '../../../../lib/financial-statement-source';
import {isSameOriginRequest} from '../../../../lib/request-origin';
import {requireUser} from '../../../../services/auth';
import {assertLiveStatements} from '../../../../services/financial-statement-live';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
const key={query:statementQuery,subsidiary:z.string().uuid(),id:z.string().uuid()};
const commandSchema=z.discriminatedUnion('action',[
 z.object({...key,action:z.literal('UPLOAD'),title:z.string().trim().min(1).max(200),
  pdf:z.string().min(24).max(2796204).regex(/^[A-Za-z0-9+/]+={0,2}$/)}).strict(),
 z.object({...key,action:z.literal('DOWNLOAD')}).strict(),
]);
const documentSchema=z.object({id:z.string().uuid(),title:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/),pdf:z.string().max(2850000).optional()});

export async function POST(request:Request){
 try{
  if(process.env.FINANCIAL_GROUP_ELIMINATION_PREVIEW!=='true')throw Error('REPORTING_DISABLED');
  if(!isSameOriginRequest(request))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});
  if(new URL(request.url).search||!request.headers.get('content-type')?.startsWith('application/json'))
   throw Error('REPORTING_INPUT_INVALID');
  const reader=request.body?.getReader();
  if(!reader)throw Error('REPORTING_INPUT_INVALID');
  const chunks:Uint8Array[]=[];
  let size=0;
  while(true){
   const {value,done}=await reader.read();
   if(done)break;
   size+=value.byteLength;
   if(size>2800000){await reader.cancel();throw Error('REPORTING_INPUT_INVALID');}
   chunks.push(value);
  }
  let input:unknown;
  try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('REPORTING_INPUT_INVALID');}
  const command=commandSchema.parse(input);
  assertLiveStatements();
  const {supabase}=await requireUser();
  const upload=command.action==='UPLOAD'?command:null;
  const result=await supabase.rpc('financial_group_acquisition_document_command',{
   p_id:command.id,p_root:command.query.organization,p_subsidiary:command.subsidiary,
   p_from:command.query.from,p_to:command.query.to,p_title:upload?.title??null,p_pdf:upload?.pdf??null,
  });
  if(result.error)throw Error(result.error.message.match(/(?:GROUP_(?:ACQUISITION|CONTROL)|REPORTING)_[A-Z_]+/)?.[0]??'REPORTING_UNAVAILABLE');
  const document=documentSchema.safeParse(result.data);
  if(!document.success||document.data.id!==command.id)throw Error('REPORTING_UNAVAILABLE');
  if(upload)return NextResponse.json({id:document.data.id,title:document.data.title,sha256:document.data.sha256},{headers});
  const pdf=Buffer.from(document.data.pdf??'','base64');
  if(pdf.length<16||pdf.length>2097152||createHash('sha256').update(pdf).digest('hex')!==document.data.sha256)
   throw Error('GROUP_ACQUISITION_DOCUMENT_CHANGED');
  return new NextResponse(Uint8Array.from(pdf),{headers:{...headers,'Content-Type':'application/pdf',
   'Content-Disposition':`attachment; filename="acquisition-${command.id}.pdf"`}});
 }catch(error){
  const code=error instanceof Error?error.message:'REPORTING_UNAVAILABLE';
  const invalid=error instanceof z.ZodError||code==='REPORTING_INPUT_INVALID';
  const status=code==='REPORTING_DISABLED'?404:code==='UNAUTHORIZED'?401:/DENIED/.test(code)?403:invalid?400:
   /CHANGED|CONFLICT/.test(code)?409:/^GROUP_(ACQUISITION|CONTROL)_/.test(code)?422:503;
  return NextResponse.json({error:invalid?'REPORTING_INPUT_INVALID':status===503?'REPORTING_UNAVAILABLE':code},{status,headers});
 }
}
