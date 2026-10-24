import {isSameOriginRequest} from '../../../../../lib/request-origin';
import {NextResponse} from 'next/server';
import {corporateZakatSources} from '../../../../../services/corporate-zakat-assessment';
import {corporateFailure} from '../workflow-response';
export async function POST(request:Request){try{if(!isSameOriginRequest(request))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403});return NextResponse.json(await corporateZakatSources(await request.json()),{headers:{'Cache-Control':'no-store'}});}catch(e){return corporateFailure(e);}}
