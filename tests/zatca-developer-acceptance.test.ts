import {describe,it,expect} from 'vitest';
import {assertDeveloperAcceptanceTarget,summarizeDeveloperResult,certificateMatchesKey,developerDeliveryMatrixPassed} from '../scripts/zatca/developer-acceptance';
import {generateKeyPairSync,X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const valid={validationResults:{status:'PASS',errorMessages:[],warningMessages:[]}};
describe('Developer Portal diagnostic acceptance boundary',()=>{
 it.each(['production','development',undefined])('rejects environment %s before cloud work',VERCEL_ENV=>{
  expect(()=>assertDeveloperAcceptanceTarget({VERCEL_ENV})).toThrow('QA_TARGET_REQUIRED');
 });
 it('requires the exact isolated project, existing key and role',()=>{
  const env={VERCEL_ENV:'preview',FATOORA_QA_AWS_REGION:'eu-north-1',FATOORA_QA_AWS_ROLE_ARN:'arn:aws:iam::701899214938:role/yaqeen-fatoora-qa-preview',
   FATOORA_QA_KMS_KEY_ARN:'arn:aws:kms:eu-north-1:701899214938:key/ab50c7e0-2251-4ae3-967d-5d14866b80d4'};
  const claims={iss:'https://oidc.vercel.com/oalhalabioa-9334',aud:'https://vercel.com/oalhalabioa-9334',sub:'owner:oalhalabioa-9334:project:yaqeen-fatoora-qa:environment:preview'};
  const token=(c:unknown)=>'header.'+Buffer.from(JSON.stringify(c)).toString('base64url')+'.signature';
  expect(()=>assertDeveloperAcceptanceTarget({...env,VERCEL_OIDC_TOKEN:token(claims)})).not.toThrow();
  expect(()=>assertDeveloperAcceptanceTarget({...env,VERCEL_OIDC_TOKEN:token({...claims,sub:'another-project'})})).toThrow('QA_IDENTITY_REQUIRED');
  expect(()=>assertDeveloperAcceptanceTarget({...env,FATOORA_QA_KMS_KEY_ARN:'another-key'})).toThrow('QA_TARGET_REQUIRED');
 });
 it('never infers acceptance from HTTP 200 or incomplete responses',()=>{
  for(const body of [null,{}, {validationResults:{status:'PASS'}}])expect(summarizeDeveloperResult(200,body,'compliance').passed).toBe(false);
  expect(summarizeDeveloperResult(500,valid,'compliance').passed).toBe(false);
  expect(summarizeDeveloperResult(200,valid,'compliance').passed).toBe(true);
 });
 it('requires the reporting or clearance disposition separately',()=>{
  expect(summarizeDeveloperResult(200,valid,'reporting').passed).toBe(false);
  expect(summarizeDeveloperResult(200,{...valid,reportingStatus:'REPORTED'},'reporting').passed).toBe(true);
  expect(summarizeDeveloperResult(200,{...valid,clearanceStatus:'NOT_CLEARED'},'clearance').passed).toBe(false);
  expect(summarizeDeveloperResult(200,{...valid,clearanceStatus:'CLEARED'},'clearance').passed).toBe(true);
 });
 it.each([
  {http:200, disposition:'REPORTED', status:'PASS', errors:0, warnings:0, outcome:'REPORTED_WITHOUT_WARNINGS'},
  {http:202, disposition:'REPORTED', status:'WARNING', errors:0, warnings:1, outcome:'REPORTED_WITH_WARNINGS'},
  {http:400, disposition:'NOT_REPORTED', status:'ERROR', errors:1, warnings:0, outcome:'REJECTED'},
  {http:422, disposition:'NOT_REPORTED', status:'ERROR', errors:1, warnings:0, outcome:'UNCONFIRMED'},
  {http:503, disposition:'REPORTED', status:'PASS', errors:0, warnings:0, outcome:'UNCONFIRMED'},
  {http:202, disposition:'REPORTED', status:'WARNING', errors:1, warnings:1, outcome:'UNCONFIRMED'},
  {http:202, disposition:'REPORTED', status:'WARNING', errors:0, warnings:0, outcome:'UNCONFIRMED'},
  {http:202, disposition:'CLEARED', status:'WARNING', errors:0, warnings:1, outcome:'UNCONFIRMED'},
  {http:200, disposition:'REPORTED', status:'PASS', errors:0, warnings:1, outcome:'UNCONFIRMED'},
  {http:400, disposition:'NOT_REPORTED', status:'ERROR', errors:0, warnings:0, outcome:'UNCONFIRMED'},
 ])('classifies reporting HTTP $http and $status as $outcome',({http,disposition,status,errors,warnings,outcome})=>{
  const result=summarizeDeveloperResult(http,{reportingStatus:disposition,validationResults:{
   status,errorMessages:Array(errors).fill({code:'BR-KSA-10',message:'private test data'}),
   warningMessages:Array(warnings).fill({code:'BR-KSA-100',message:'private test data'}),
  }},'reporting');
  expect(result.reportingOutcome).toBe(outcome);
  expect(result.passed).toBe(outcome==='REPORTED_WITHOUT_WARNINGS');
  expect(JSON.stringify(result)).not.toContain('private test data');
 });
 it('leaves incomplete reporting responses unconfirmed',()=>{
  expect(summarizeDeveloperResult(202,{reportingStatus:'REPORTED',validationResults:{
   status:'WARNING',warningMessages:[{code:'BR-KSA-100'}],
  }},'reporting')).toMatchObject({reportingOutcome:'UNCONFIRMED',passed:false});
 });
 it('retains safe rule codes and removes raw messages and untrusted code strings',()=>{
  const secret='sensitive-credential-value';const r=summarizeDeveloperResult(200,{...valid,secret,validationResults:{status:'ERROR',warningMessages:[],
   errorMessages:[{code:'BR-KSA-10',message:secret},{code:secret,message:secret}]}},'compliance');
  expect(r.errorCodes).toEqual(['BR-KSA-10','UNCLASSIFIED_AUTHORITY_MESSAGE']);
  expect(JSON.stringify(r)).not.toContain(secret);expect(r.passed).toBe(false);
 });
 it('does not silently accept warnings',()=>{
  expect(summarizeDeveloperResult(200,{validationResults:{status:'PASS',errorMessages:[],warningMessages:[{code:'BR-KSA-10'}]}},'compliance').passed).toBe(false);
 });
 it('rejects malformed certificate responses',()=>{
  expect(()=>certificateMatchesKey('not-a-certificate',Buffer.alloc(32))).toThrow('CERTIFICATE_RESPONSE_INVALID');
 });
 it('requires the same actual public key for DER, PEM and nested Base64 certificates',()=>{
  const dir=mkdtempSync(join(tmpdir(),'developer-csid-key-'));
  try {
   execFileSync('openssl',['req','-new','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:secp256k1','-nodes',
    '-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=Synthetic QA Only'],{stdio:'pipe'});
   const pem=readFileSync(join(dir,'cert.pem')),cert=new X509Certificate(pem),spki=cert.publicKey.export({format:'der',type:'spki'});
   for(const token of [cert.raw.toString('base64'),pem.toString('base64'),Buffer.from(cert.raw.toString('base64')).toString('base64')])
    expect(certificateMatchesKey(token,spki).raw).toEqual(cert.raw);
   const wrong=generateKeyPairSync('ec',{namedCurve:'secp256k1'}).publicKey.export({format:'der',type:'spki'});
   expect(()=>certificateMatchesKey(cert.raw.toString('base64'),wrong)).toThrow('AUTHORITY_CERTIFICATE_KEY_MISMATCH');
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
});


describe('complete Developer Portal delivery matrix',()=>{
 const delivered=()=>['STANDARD','SIMPLIFIED'].flatMap(category=>['INVOICE','CREDIT_NOTE','DEBIT_NOTE'].map(document=>{
  const operation=category==='STANDARD'?'clearance' as const:'reporting' as const;
  return {category,document,operation,...summarizeDeveloperResult(200,{...valid,
   ...(operation==='clearance'?{clearanceStatus:'CLEARED'}:{reportingStatus:'REPORTED'})},operation)};
 }));
 it('requires all six distinct successful document and route outcomes',()=>{
  expect(developerDeliveryMatrixPassed(delivered())).toBe(true);
  expect(developerDeliveryMatrixPassed([])).toBe(false);
  expect(developerDeliveryMatrixPassed(delivered().slice(1))).toBe(false);
  const duplicate=delivered();duplicate[5]=duplicate[4];
  expect(developerDeliveryMatrixPassed(duplicate)).toBe(false);
 });
 it('never completes the diagnostic after an HTTP-only success, warning, or rejected document',()=>{
  for(const outcome of [{http:500},{passed:false},{validationStatus:'WARNING'},
   {disposition:'NOT_CLEARED'},{warningCodes:['BR-KSA-10']},{errorCodes:['XSD_ERROR']}]){
   const results=delivered();Object.assign(results[0],outcome);
   expect(developerDeliveryMatrixPassed(results)).toBe(false);
  }
 });
 it('rejects wrong routes and missing or unknown document identities',()=>{
  const wrong=delivered();wrong[0].operation='reporting';wrong[0].disposition='REPORTED';
  expect(developerDeliveryMatrixPassed(wrong)).toBe(false);
  for(const identity of [{document:''},{document:'OTHER'},{category:'OTHER'}]){
   const results=delivered();Object.assign(results[0],identity);
   expect(developerDeliveryMatrixPassed(results)).toBe(false);
  }
 });
});
