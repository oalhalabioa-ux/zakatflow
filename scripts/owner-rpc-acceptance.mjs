import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const QA_URL = 'https://weucywfwbdnomtlkjurl.supabase.co';
export const TEST_EMAIL = 'rpc-qa-test-20261028@example.invalid';
export const cases = [
  ['owner_user_count', {}], ['owner_organization_count', {}],
  ['owner_subscription_summary', {}], ['owner_list_users', {p_page:1,p_per_page:1}],
  ['owner_list_organizations', {p_page:1,p_per_page:1}],
  ['owner_list_payment_transactions', {p_limit:1}], ['owner_list_plans', {}],
  ['owner_list_subscriptions', {}], ['owner_list_audit_events', {p_limit:1}],
  ['owner_change_subscription_status', {p_subscription_id:null,p_expected_status:null,p_new_status:null}],
  ['owner_upsert_plan', {p_code:null,p_name_ar:null,p_price:null,p_currency:null,p_interval:null,p_active:null,p_id:null}],
];

export async function verify({url=QA_URL, key, email=TEST_EMAIL, password, request=fetch}) {
  if(url !== QA_URL || email !== TEST_EMAIL) throw Error('QA_IDENTITY_CONFIG_REQUIRED');
  let claims;
  try { claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()); } catch {}
  // Only the legacy public anon key for the explicitly allowed QA project is accepted.
  if(claims?.role !== 'anon' || claims?.ref !== 'weucywfwbdnomtlkjurl') throw Error('QA_ANON_KEY_REQUIRED');
  if(!password) throw Error('PASSWORD_REQUIRED');
  let session;
  const report={project:'weucywfwbdnomtlkjurl',authenticatedOrdinaryUser:false,cases:[],logout:false,refreshRevoked:false};
  const call=async(path,body,token=key)=>{
    const response=await request(url+path,{method:body===undefined?'GET':'POST',headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
    let data=null;try{data=await response.json();}catch{}
    return {status:response.status,ok:response.ok,data};
  };
  try {
    const login=await call('/auth/v1/token?grant_type=password',{email,password});
    if(!login.ok || !login.data?.access_token) throw Error('QA_LOGIN_FAILED');
    session=login.data;
    if(session.user?.email!==TEST_EMAIL) throw Error('QA_USER_MISMATCH');
    const identity=await call('/auth/v1/user',undefined,session.access_token);
    if(!identity.ok || identity.data?.id!==session.user.id) throw Error('SESSION_IDENTITY_FAILED');
    const role=await call('/rest/v1/rpc/owner_authorized',{},session.access_token);
    if(!role.ok || role.data!==false) throw Error('ORDINARY_USER_REQUIRED');
    report.authenticatedOrdinaryUser=true;
    for(const [name,args] of cases){
      const result=await call('/rest/v1/rpc/'+name,args,session.access_token);
      // A missing RPC, network failure or parameter error is NOT a passing denial.
      const denied=result.status===403 && result.data?.code==='42501';
      report.cases.push({name,status:result.status,code:result.data?.code??null,denied});
      if(!denied) throw Error('RPC_DENIAL_FAILED:'+name);
    }
  } finally {
    if(session){
      const logout=await call('/auth/v1/logout?scope=local',{},session.access_token);
      report.logout=logout.ok;
      if(!logout.ok) throw Error('LOGOUT_FAILED');
      const refresh=await call('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token});
      report.refreshRevoked=refresh.status===400 && ['refresh_token_not_found','refresh_token_already_used','session_not_found'].includes(refresh.data?.error_code??refresh.data?.code);
      if(!report.refreshRevoked) throw Error('REFRESH_REVOCATION_NOT_PROVEN');
      session=null;
    }
  }
  return {...report,passed:true,checkedAt:new Date().toISOString()};
}

async function hiddenPassword(){
  if(!stdin.isTTY) throw Error('INTERACTIVE_TERMINAL_REQUIRED');
  stdout.write('QA test password (hidden): ');
  stdin.setRawMode(true);stdin.resume();
  return new Promise((resolve,reject)=>{
    let value='';
    const cleanup=()=>{stdin.removeListener('data',read);stdin.setRawMode(false);stdin.pause();stdout.write('\n');};
    const read=(chunk)=>{for(const char of chunk.toString()){
      if(char==='\u0003'){cleanup();reject(Error('CANCELLED'));return;}
      if(char==='\r'||char==='\n'){cleanup();resolve(value);value='';return;}
      if(char==='\u007f'||char==='\b')value=value.slice(0,-1);else if(char>=' ')value+=char;
    }};
    stdin.on('data',read);
  });
}

async function main(){
  let key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!key){const prompt=createInterface({input:stdin,output:stdout});try{key=await prompt.question('Public QA anon key (never service_role): ');}finally{prompt.close();}}
  let password=process.env.OWNER_QA_RPC_PASSWORD || await hiddenPassword();
  delete process.env.OWNER_QA_RPC_PASSWORD;
  try{
    const result=await verify({key,password});
    await writeFile('owner-rpc-acceptance-result.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});
    console.log('PASS: 11 actual-session RPC denials; logout and refresh revocation verified.');
  }finally{password='';}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
