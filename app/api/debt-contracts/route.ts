import {NextResponse} from 'next/server';
import {z} from 'zod';
import {debtContracts,debtContractsGroup,debtContractAction,debtContractCatalog,debtContractReview} from '../../../services/debt-contracts';
const headers={'Cache-Control':'no-store'};
function failure(e:unknown){const m=e instanceof z.ZodError?'VALIDATION_FAILED':e&&typeof e==='object'&&'message'in e?String(e.message):'';const error=/^[A-Z][A-Z_]+$/.test(m)?m:'DEBT_CONTRACT_FAILED';return NextResponse.json({error},{status:error==='UNAUTHORIZED'?401:/DENIED|ACCESS/.test(error)?403:error==='DEBT_CONTRACT_FAILED'?500:400,headers});}
export async function GET(r:Request){try{const q=new URL(r.url).searchParams,org=q.get('organization_id')??'',id=q.get('contract_id');return NextResponse.json(id?await debtContractReview(org,id):q.get('context')==='1'?await debtContractCatalog(org):await (q.get('group')==='1'?debtContractsGroup:debtContracts)(org,q.has('kind')?z.enum(['OPENING','LOAN','EMPLOYEE_ADVANCE']).parse(q.get('kind')):undefined),{headers});}catch(e){return failure(e);}}
export async function POST(r:Request){try{if(r.headers.get('origin')!==new URL(r.url).origin)return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});return NextResponse.json(await debtContractAction(await r.json()),{headers});}catch(e){return failure(e);}}
