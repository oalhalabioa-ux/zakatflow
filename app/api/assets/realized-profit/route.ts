import {NextResponse} from 'next/server';
import {readAssetRealizedProfits} from '@/services/asset-realized-profit';

export async function GET(request: Request) {
  const scope = new URL(request.url).searchParams.get('scope');
  if (scope !== 'PERSONAL' && scope !== 'ORGANIZATION') {
    return NextResponse.json({error: 'ASSET_REPORT_SCOPE_INVALID'}, {status: 400});
  }
  try {
    return NextResponse.json(await readAssetRealizedProfits(scope), {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({error: 'UNAUTHORIZED'}, {status: 401});
    }
    return NextResponse.json({error: 'ASSET_REALIZED_PROFIT_UNAVAILABLE'}, {status: 500});
  }
}
