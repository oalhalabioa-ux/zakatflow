import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assetEditAvailability,createAsset,listAssets,updateAsset } from '@/services/assets';

const assetEdit = z.strictObject({
  id: z.uuid(),
  expected_updated_at: z.iso.datetime({ offset: true }),
  name: z.string().trim().min(1).max(120).optional(),
  market_price: z.number().finite().nonnegative().optional(),
}).refine(input => (input.name === undefined) !== (input.market_price === undefined));

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('edit_asset_id');
  if (id !== null && !z.uuid().safeParse(id).success) {
    return NextResponse.json({error:'ASSET_EDIT_INPUT_INVALID'}, {status:400});
  }
  try {
    return NextResponse.json(id === null ? await listAssets() : await assetEditAvailability(id),
      {headers:{'Cache-Control':'no-store'}});
  } catch (error) {
    const code = (error as {message?: string})?.message;
    return NextResponse.json({error:code}, {status:code==='UNAUTHORIZED'?401:code==='ASSET_NOT_FOUND'?404:500});
  }
}

export async function POST(req:Request){
  try{return NextResponse.json(await createAsset(await req.json()),{status:201})}
  catch(e:any){return NextResponse.json({error:e.message},{status:400})}
}

export async function PUT(req: Request) {
  const input = assetEdit.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({error: 'ASSET_EDIT_INPUT_INVALID'}, {status: 400});
  const {id, ...changes} = input.data;
  try {
    return NextResponse.json(await updateAsset(id, changes));
  } catch (error) {
    const code = (error as {message?: string})?.message;
    const statuses: Record<string, number> = {
      UNAUTHORIZED: 401,
      ASSET_NOT_FOUND: 404,
      ASSET_EDIT_ACCESS_DENIED: 403,
      ASSET_EDIT_CONFLICT: 409,
      ASSET_REGISTRATION_LOCKED: 409,
      ASSET_AUTOMATIC_VALUATION_REQUIRED: 409,
      ASSET_EDIT_NAME_INVALID: 400,
      ASSET_EDIT_PRICE_INVALID: 400,
      ASSET_EDIT_VALUATION_UNSUPPORTED: 400,
    };
    const status = code && Object.hasOwn(statuses, code) ? statuses[code] : 500;
    const info = error as {details?: string};
    let registration_lock;
    if (code === 'ASSET_REGISTRATION_LOCKED' && info.details) {
      try { registration_lock = JSON.parse(info.details); } catch {}
    }
    return NextResponse.json({error: status === 500 ? 'ASSET_EDIT_FAILED' : code, registration_lock}, {status});
  }
}
