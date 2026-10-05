import {NextResponse} from 'next/server';
import {retryOrganizationAssetPurchaseRecognition} from '@/services/transactions';

export async function POST(_req:Request,{params}:{params:Promise<{id:string}>}){try{const{id}=await params;return NextResponse.json(await retryOrganizationAssetPurchaseRecognition(id))}catch(e:any){const message=e?.message||'ASSET_FINANCIAL_CORE_RETRY_FAILED';const status=message==='UNAUTHORIZED'?401:message==='TRANSACTION_NOT_FOUND'?404:400;return NextResponse.json({error:message},{status})}}
