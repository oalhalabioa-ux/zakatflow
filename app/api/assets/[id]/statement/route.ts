import {NextResponse} from 'next/server';
import {z} from 'zod';
import {assetStatementQuery,readAssetStatement} from '../../../../../services/asset-statement';

const statuses:Record<string,number> = {
 UNAUTHORIZED:401, ASSET_NOT_FOUND:404, ASSET_STATEMENT_SPECIALIZED_SOURCE:422,
 ASSET_STATEMENT_BASE_CURRENCY:422, ASSET_STATEMENT_LIMIT:422,
};
const options={headers:{'Cache-Control':'private, no-store'}};

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const parsedId=z.string().uuid().safeParse((await params).id);
 const parsedQuery=assetStatementQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if(!parsedId.success||!parsedQuery.success)
  return NextResponse.json({error:'ASSET_STATEMENT_INVALID_QUERY'},{...options,status:400});
 try{
  return NextResponse.json(await readAssetStatement(parsedId.data,parsedQuery.data),options);
 }catch(error){
  const code=error instanceof Error?error.message:'ASSET_STATEMENT_READ_FAILED';
  return NextResponse.json({error:statuses[code]?code:'ASSET_STATEMENT_READ_FAILED'},
   {...options,status:statuses[code]??500});
 }
}
