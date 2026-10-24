import {isSameOriginRequest} from '../../../../../lib/request-origin';
import {NextResponse} from 'next/server';
import {corporateZakatAction,corporateZakatDetail} from '../../../../../services/corporate-zakat-assessment';
import {corporateFailure} from '../workflow-response';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{return NextResponse.json(await corporateZakatDetail((await params).id),{headers:{'Cache-Control':'no-store'}});}catch(e){return corporateFailure(e);}}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{if(!isSameOriginRequest(request))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403});return NextResponse.json(await corporateZakatAction((await params).id,await request.json()),{headers:{'Cache-Control':'no-store'}});}catch(e){return corporateFailure(e);}}
