/** Deliberately contains no credentials, raw headers, URLs or error-body logging. */
export const ADMIN_HEADER_ERROR='SUPABASE_SERVICE_ROLE_KEY_INVALID_HEADER';
export type AdminTransportFailure='INVALID_HEADERS'|'DNS'|'TLS'|'TIMEOUT'|'CONNECTION'|'ABORTED'|'UNKNOWN';
const prefix='SUPABASE_ADMIN_FETCH_';
const kinds:AdminTransportFailure[]=['INVALID_HEADERS','DNS','TLS','TIMEOUT','CONNECTION','ABORTED','UNKNOWN'];
const codes:Record<string,AdminTransportFailure>={ENOTFOUND:'DNS',EAI_AGAIN:'DNS',ECONNREFUSED:'CONNECTION',ECONNRESET:'CONNECTION',EPIPE:'CONNECTION',UND_ERR_SOCKET:'CONNECTION',ETIMEDOUT:'TIMEOUT',UND_ERR_CONNECT_TIMEOUT:'TIMEOUT',UND_ERR_HEADERS_TIMEOUT:'TIMEOUT',UND_ERR_BODY_TIMEOUT:'TIMEOUT',CERT_HAS_EXPIRED:'TLS',CERT_NOT_YET_VALID:'TLS',DEPTH_ZERO_SELF_SIGNED_CERT:'TLS',SELF_SIGNED_CERT_IN_CHAIN:'TLS',UNABLE_TO_VERIFY_LEAF_SIGNATURE:'TLS',UNABLE_TO_GET_ISSUER_CERT_LOCALLY:'TLS',ERR_TLS_CERT_ALTNAME_INVALID:'TLS',ERR_INVALID_CHAR:'INVALID_HEADERS',ERR_HTTP_INVALID_HEADER_VALUE:'INVALID_HEADERS'};
export function validateAdminHeaders(key:string){
  try{new Headers({apikey:key,Authorization:`Bearer ${key}`});}
  catch{throw Error(ADMIN_HEADER_ERROR);}
}
export function classifyAdminTransport(error:unknown):AdminTransportFailure{
  const queue:unknown[]=[error],seen=new Set<unknown>();
  for(let n=0;queue.length&&n<16;n++){
    const item=queue.shift();if(!item||typeof item!=='object'||seen.has(item))continue;seen.add(item);
    const e=item as {code?:unknown;name?:unknown;message?:unknown;cause?:unknown;errors?:unknown[]};
    if(typeof e.code==='string'&&Object.hasOwn(codes,e.code))return codes[e.code];
    if(e.name==='TimeoutError')return 'TIMEOUT';
    if(e.name==='AbortError')return 'ABORTED';
    // Inspect locally, but never return or log the raw error message.
    if(typeof e.message==='string'&&/ByteString|Headers\.(set|append)|invalid header value/i.test(e.message))return 'INVALID_HEADERS';
    if(e.cause)queue.push(e.cause);
    if(Array.isArray(e.errors))queue.push(...e.errors.slice(0,6));
  }
  return 'UNKNOWN';
}
export const adminDiagnosticFetch:typeof fetch=async(input,init)=>{
  try{return await fetch(input,init);}
  catch(error){throw Error(prefix+classifyAdminTransport(error));}
};
export function adminTransportFromResult(error:{message?:unknown}):AdminTransportFailure{
  const message=typeof error.message==='string'?error.message:'';
  return kinds.find(kind=>message===prefix+kind||message==='Error: '+prefix+kind)??'UNKNOWN';
}
