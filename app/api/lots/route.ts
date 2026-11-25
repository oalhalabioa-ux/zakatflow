import {NextResponse} from 'next/server';
import {listLots} from '../../../services/lots';
import {readLotWorkspaceScope} from '../../../lib/lot-workspace-scope';
import {lotError} from './errors';
export async function GET(request:Request){try{return NextResponse.json(await listLots(readLotWorkspaceScope(new URL(request.url).searchParams)),{headers:{'Cache-Control':'no-store'}})}catch(error){return lotError(error)}}
