import {NextResponse} from 'next/server';
import {readOperationalReportScope} from '@/lib/operational-report-scope';
import {fixedReportQuery, readFixedAssetReport} from '@/services/fixed-asset-report';

const headers = {'Cache-Control': 'private, no-store'};
const statuses: Record<string, number> = {
 UNAUTHORIZED: 401, ORGANIZATION_ACCESS_REQUIRED: 403, FIXED_ASSET_ACCESS_DENIED: 403,
 FIXED_ASSET_FILTER_SCOPE: 400, FIXED_ASSET_BASE_CURRENCY: 422, FIXED_ASSET_REPORT_LIMIT: 422,
};

export async function GET(request: Request) {
 const parameters = new URL(request.url).searchParams;
 const query = fixedReportQuery.safeParse(Object.fromEntries(parameters));
 let scope;
 try {
  scope = readOperationalReportScope(parameters);
 } catch {
  return NextResponse.json({error: 'FIXED_ASSET_INVALID_QUERY'}, {headers, status: 400});
 }
 if (!query.success) return NextResponse.json({error: 'FIXED_ASSET_INVALID_QUERY'}, {headers, status: 400});
 try {
  return NextResponse.json(await readFixedAssetReport(scope, query.data), {headers});
 } catch (error) {
  const code = error instanceof Error ? error.message : '';
  return NextResponse.json({error: statuses[code] ? code : 'FIXED_ASSET_READ_FAILED'}, {headers, status: statuses[code] ?? 500});
 }
}
