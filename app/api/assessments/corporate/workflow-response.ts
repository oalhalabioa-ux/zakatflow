import {NextResponse} from 'next/server';
import {z} from 'zod';
export function corporateFailure(e:unknown){const message=e instanceof z.ZodError?'CORPORATE_ZAKAT_VALUES_INVALID':e&&typeof e==='object'&&'message'in e?String(e.message):'';const code=/^[A-Z][A-Z_]+$/.test(message)?message:'CORPORATE_ZAKAT_FAILED';return NextResponse.json({error:code},{status:code==='UNAUTHORIZED'?401:/DENIED|ACCESS|ORIGIN/.test(code)?403:code==='CORPORATE_ZAKAT_FAILED'?500:409,headers:{'Cache-Control':'no-store'}});}
