import {NextResponse} from 'next/server';
export function budgetError(error:unknown,fallback=400){
 const code=error instanceof Error?error.message:'BUDGET_UNAVAILABLE';
 const status=code==='UNAUTHORIZED'?401:code==='ORGANIZATION_ACCESS_REQUIRED'?403:code==='ORGANIZATION_ID_REQUIRED'?400:fallback;
 return NextResponse.json({error:code},{status,headers:{'Cache-Control':'no-store'}});
}
