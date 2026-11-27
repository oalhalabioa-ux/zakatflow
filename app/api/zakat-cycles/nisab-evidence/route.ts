import {NextResponse} from 'next/server';
import {nisabEvidence} from '@/services/nisab-evidence';
export async function POST(request:Request) {
 try {return NextResponse.json(await nisabEvidence((await request.json()).nisab_standard));}
 catch(e) {const message=e instanceof Error?e.message:'NISAB_EVIDENCE_FAILED';
 return NextResponse.json({error:message},{status:message==='UNAUTHORIZED'?401:400});}
}
