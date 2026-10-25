import {Pool} from 'pg';
import {execFileSync} from 'node:child_process';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createVerifiedZatcaEnrollmentAuditStore} from './zatca-private-enrollment-audit';
import {createVerifiedZatcaEnrollmentAuditor} from './zatca-private-enrollment-auditor';
const enabled=process.env.ZATCA_PRIVATE_AUDIT_SQL_QA==='1';let pool:Pool;
async function fixture(){
  const f=JSON.parse(execFileSync('python3',['-c',"import runpy,json;s=runpy.run_path('tests/zatca-enrollment-verification-audit-postgres.py');f=s['Audit']();f.setUp();print(json.dumps(dict(org=f.f.org,actor=f.f.actor,connection=f.f.connection,enrollment=f.r.enrollment,dispatch=f.r.dispatch,check=f.check,receipt=f.receipt['receipt_digest'],evidence=f.evidence,active=f.active)))"],{encoding:'utf8',stdio:['pipe','pipe','pipe']}));
  const context={organizationId:f.org,connectionId:f.connection,environment:'SIMULATION',enrollmentId:f.enrollment,dispatchId:f.dispatch,checkId:f.check,receiptDigest:f.receipt};
  const {receiptDigest:_digest,...input}=context,auth={getUser:async()=>({data:{user:{id:f.actor,aud:'authenticated',is_anonymous:false}},error:null})},store=createVerifiedZatcaEnrollmentAuditStore(auth as never,pool);
  const state=async()=>(await pool.query('select status,credentials_secret_arn from public.vat_einvoice_connections where id=$1',[f.connection])).rows[0];
  return {f,context,input,auth,store,state,record:()=>store.recordVerification('SYNTHETIC.TOKEN',context,f.evidence),handoff:()=>store.recordCompliancePending('SYNTHETIC.TOKEN',context,f.active)};
}
async function clean(){const cs=await Promise.all(Array.from({length:4},()=>pool.connect()));try{for(const c of cs)expect(Object.values((await c.query("select auth.uid() as actor,nullif(current_setting('request.jwt.claims',true),'') as claims,nullif(current_setting('request.jwt.claim',true),'') as legacy,nullif(current_setting('request.jwt.claim.role',true),'') as role,nullif(current_setting('request.jwt.claim.email',true),'') as email")).rows[0])).toEqual([null,null,null,null,null]);}finally{cs.forEach(c=>c.release());}}
beforeAll(async()=>{if(!enabled)return;if(process.env.ZATCA_LEDGER_DISPOSABLE_QA!=='1'||process.env.PGDATABASE!=='zatca_ledger_qa')throw new Error('DISPOSABLE_LEDGER_QA_REQUIRED');pool=new Pool({max:4,connectionTimeoutMillis:2000,query_timeout:7000,application_name:'zatca-private-audit-qa'});expect((await pool.query('select current_database() as name')).rows[0].name).toBe('zatca_ledger_qa');});
afterAll(async()=>{if(pool)await pool.end();});
describe.skipIf(!enabled)('private verification audit/pending handoff actual PostgreSQL',()=>{
  it('finds no audit, records it and reloads the immutable first actor/time',async()=>{
    const f=await fixture();expect((await f.store.findVerification('SYNTHETIC.TOKEN',f.input)).audit).toBeNull();const first=await f.record();expect((await f.store.findVerification('SYNTHETIC.TOKEN',f.input)).audit).toEqual(first);expect(await f.record()).toEqual(first);await clean();
  });
  it('moves only to pending compliance and leaves signer registry empty',async()=>{
    const f=await fixture();await f.record();const r=await f.handoff();expect(r.state).toBe('COMPLIANCE_PENDING');expect(await f.state()).toEqual({status:'COMPLIANCE_PENDING',credentials_secret_arn:f.f.active.secretArn});expect(await f.handoff()).toEqual(r);
    expect((await pool.query('select count(*) as n from zatca_preparation.signer_versions where connection_id=$1',[f.f.connection])).rows[0].n).toBe('0');await clean();
  });
  it('serializes concurrent exact audit writes and handoffs without duplicate attribution',async()=>{
    const f=await fixture(),audits=await Promise.all(Array.from({length:8},f.record));audits.forEach(r=>expect(r).toEqual(audits[0]));const handoffs=await Promise.all(Array.from({length:8},f.handoff));handoffs.forEach(r=>expect(r).toEqual(handoffs[0]));await clean();
  });
  it.each(['audit','handoff'])('recovers a real committed %s after a lost COMMIT acknowledgement without refreshing proof',async step=>{
    const f=await fixture();if(step==='handoff')await f.record();let injected=false;
    const uncertainPool={connect:async()=>{const c=await pool.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,params?:unknown[])=>{const r=await target.query(sql,params);if(sql==='COMMIT'&&!injected){injected=true;throw new Error('SYNTHETIC_LOST_ACK');}return r;};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});}};
    const store=createVerifiedZatcaEnrollmentAuditStore(f.auth as never,uncertainPool as never);
    await expect(step==='audit'?store.recordVerification('SYNTHETIC.TOKEN',f.context,f.f.evidence):store.recordCompliancePending('SYNTHETIC.TOKEN',f.context,f.f.active)).rejects.toThrow(/ENROLLMENT_DATABASE_(AUDIT_WRITE|HANDOFF)_FAILED/);
    const first=(await f.store.findVerification('SYNTHETIC.TOKEN',f.input)).audit!;expect(first).not.toBeNull();
    const send=vi.fn(async()=>{throw new Error('Unexpected cloud operation');});
    const auditor=createVerifiedZatcaEnrollmentAuditor(f.auth as never,pool,{secrets:{send},kms:{send}} as never,{quarantine:{region:'eu-central-1',accountId:'123456789012',encryptionKeyArn:f.f.active.encryptionKeyArn},trust:{},pathEvidence:{}});
    const replay=await auditor.verifyAndRecord('SYNTHETIC.TOKEN',f.input);expect(replay).toEqual({...first,stage:'VERIFICATION_AUDIT_REPLAY_ONLY'});expect(send).not.toHaveBeenCalled();if(step==='handoff')expect((await f.handoff()).state).toBe('COMPLIANCE_PENDING');await clean();
  });
  it.each(['audit','handoff'])('rolls back a %s whose returned persistence receipt is corrupt',async step=>{
    const f=await fixture();if(step==='handoff')await f.record();
    const corruptPool={connect:async()=>{const c=await pool.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,params?:unknown[])=>{const r=await target.query(sql,params);if(sql.includes(step==='audit'?'record_response_verification':'record_initial_credential_handoff'))r.rows[0].integrity_valid=false;return r;};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});}};
    const store=createVerifiedZatcaEnrollmentAuditStore(f.auth as never,corruptPool as never);
    await expect(step==='audit'?store.recordVerification('SYNTHETIC.TOKEN',f.context,f.f.evidence):store.recordCompliancePending('SYNTHETIC.TOKEN',f.context,f.f.active)).rejects.toThrow(step==='audit'?'ENROLLMENT_AUDIT_RECEIPT_INVALID':'ENROLLMENT_HANDOFF_RECEIPT_INVALID');
    expect(await f.state()).toEqual({status:'KEY_READY',credentials_secret_arn:null});if(step==='audit')expect((await f.store.findVerification('SYNTHETIC.TOKEN',f.input)).audit).toBeNull();else expect((await pool.query('select count(*) as n from zatca_preparation.initial_credential_handoffs where dispatch_id=$1',[f.f.dispatch])).rows[0].n).toBe('0');await clean();
  });
  it('rechecks committed membership revocation before a pending-compliance handoff',async()=>{
    const f=await fixture();await f.record();const admin=new Pool({max:1,connectionTimeoutMillis:2000,query_timeout:7000});
    try{await admin.query('begin');await admin.query("update public.organization_members set status='INACTIVE' where organization_id=$1",[f.f.org]);const pending=f.handoff().then(value=>({value}),error=>({error}));let waiting=false;
      for(let i=0;i<30;i++){await admin.query('select pg_stat_clear_snapshot()');const r=await admin.query("select exists(select 1 from pg_stat_activity where application_name='zatca-private-audit-qa' and wait_event_type='Lock') as waiting");if(r.rows[0].waiting){waiting=true;break;}await new Promise(r=>setTimeout(r,25));}
      expect(waiting).toBe(true);await admin.query('commit');const r=await pending;expect('error' in r?r.error.message:'unexpected success').toBe('ORGANIZATION_ADMIN_REQUIRED');expect(await f.state()).toEqual({status:'KEY_READY',credentials_secret_arn:null});
    }finally{await admin.query('rollback');await admin.end();}await clean();
  });
});
