import {NextResponse} from 'next/server';
import {getLot} from '../../../../services/lots';
import {lotError} from '../errors';
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){try{return NextResponse.json(await getLot((await params).id),{headers:{'Cache-Control':'no-store'}})}catch(error){return lotError(error)}}
