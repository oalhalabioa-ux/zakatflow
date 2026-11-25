import {NextResponse} from 'next/server';
import {z} from 'zod';
export function lotError(error:unknown){
 const raw=error instanceof Error?error.message:String((error as {message?:string})?.message??'');
 const code=error instanceof z.ZodError?'LOT_INPUT_INVALID':/^[A-Z][A-Z_]+$/.test(raw)?raw:'LOT_LOAD_FAILED';
 return NextResponse.json({error:code},{status:code==='UNAUTHORIZED'?401:code==='LOT_NOT_FOUND'?404:/ACCESS|PERMISSION|DENIED/.test(code)?403:code==='LOT_LOAD_FAILED'?500:400,headers:{'Cache-Control':'no-store'}});
}
