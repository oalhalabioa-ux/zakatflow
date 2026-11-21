/** Explicit Developer Portal diagnostic only. Never imported by an app route.
 * Uses the existing QA KMS key; does not create keys/secrets or access a database.
 * Credentials live only in memory and no raw authority error/response is logged.
 */
import {createHash,createPublicKey,randomUUID,X509Certificate} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {KMSClient,GetPublicKeyCommand,SignCommand} from '@aws-sdk/client-kms';
import {awsCredentialsProvider} from '@vercel/oidc-aws-credentials-provider';
import {createZatcaDeveloperSandboxCsr} from '../../lib/vat-zatca-csr';
import {buildUnsignedZatcaXml} from '../../lib/zatca-phase2-xml';
import {prepareZatcaInvoiceHash} from '../../lib/zatca-xml-hash';
import {prepareZatcaSdk345QaDocument} from '../../tests/helpers/zatca-sdk345-qa-profile';

const base='https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal';
const account='701899214938';
export function assertDeveloperAcceptanceTarget(env:Record<string,string|undefined>) {
 if(env.VERCEL_ENV!=='preview'||env.FATOORA_QA_AWS_REGION!=='eu-north-1'
  ||env.FATOORA_QA_AWS_ROLE_ARN!==`arn:aws:iam::${account}:role/yaqeen-fatoora-qa-preview`
  ||env.FATOORA_QA_KMS_KEY_ARN!==`arn:aws:kms:eu-north-1:${account}:key/ab50c7e0-2251-4ae3-967d-5d14866b80d4`)
  throw Error('QA_TARGET_REQUIRED');
 let claims:Record<string,unknown>;
 try {claims=JSON.parse(Buffer.from(env.VERCEL_OIDC_TOKEN!.split('.')[1],'base64url').toString());}
 catch {throw Error('QA_IDENTITY_REQUIRED');}
 if(claims.sub!=='owner:oalhalabioa-9334:project:yaqeen-fatoora-qa:environment:preview'
  ||claims.iss!=='https://oidc.vercel.com/oalhalabioa-9334'
  ||claims.aud!=='https://vercel.com/oalhalabioa-9334') throw Error('QA_IDENTITY_REQUIRED');
 // STS, through the existing credential provider, verifies the token signature.
}

export function summarizeDeveloperResult(http:number,input:unknown,operation:'compliance'|'reporting'|'clearance') {
 const body=input&&typeof input==='object'?input as Record<string,unknown>:{};
 const validation=body.validationResults&&typeof body.validationResults==='object'
  ?body.validationResults as Record<string,unknown>:{};
 const messages=(key:string)=>Array.isArray(validation[key])?validation[key] as unknown[]:null;
 const errors=messages('errorMessages'),warnings=messages('warningMessages');
 const codes=(items:unknown[]|null)=>items?.map(item=>{
  const code=item&&typeof item==='object'?(item as Record<string,unknown>).code:null;
  return typeof code==='string'&&/^(BR-|XSD|QR_|SIGNATURE_|CERTIFICATE_)[A-Za-z0-9_.-]{0,70}$/.test(code)
   ?code:'UNCLASSIFIED_AUTHORITY_MESSAGE';
 })??[];
 const disposition=operation==='reporting'?body.reportingStatus:operation==='clearance'?body.clearanceStatus:null;
 const validationPassed=http===200&&validation.status==='PASS'&&errors!==null&&warnings!==null
  &&errors.length===0&&warnings.length===0;
 const outcomeMatched=operation==='compliance'||(operation==='reporting'?disposition==='REPORTED':disposition==='CLEARED');
 return {http,validationStatus:['PASS','WARNING','ERROR'].includes(String(validation.status))?String(validation.status):'UNRECOGNIZED',
  disposition:['REPORTED','CLEARED','NOT_REPORTED','NOT_CLEARED'].includes(String(disposition))?String(disposition):null,
  errorCodes:codes(errors),warningCodes:codes(warnings),passed:validationPassed&&outcomeMatched};
}

type DeliveryResult=ReturnType<typeof summarizeDeveloperResult>&{
 category:string;document:string;operation:'reporting'|'clearance';
};
/** Completeness is independent of individual HTTP responses: all six unique
 * document/route combinations must succeed before this diagnostic is complete.
 * This still does not establish application or production acceptance.
 */
export function developerDeliveryMatrixPassed(results:readonly DeliveryResult[]) {
 const expected=new Set(['STANDARD','SIMPLIFIED'].flatMap(category=>
  ['INVOICE','CREDIT_NOTE','DEBIT_NOTE'].map(document=>`${category}:${document}`)));
 if(results.length!==expected.size)return false;
 for(const result of results){
  const operation=result.category==='SIMPLIFIED'?'reporting':'clearance';
  if(!expected.delete(`${result.category}:${result.document}`)||result.operation!==operation
   ||result.http!==200||result.validationStatus!=='PASS'||!result.passed
   ||result.errorCodes.length||result.warningCodes.length
   ||result.disposition!==(operation==='reporting'?'REPORTED':'CLEARED'))return false;
 }
 return expected.size===0;
}

export function certificateMatchesKey(token:unknown,expectedSpki:Buffer) {
 if(typeof token!=='string'||token.length>65536)throw Error('CERTIFICATE_RESPONSE_INVALID');
 const decoded=Buffer.from(token,'base64');
 let cert:X509Certificate;
 try {cert=new X509Certificate(decoded);}
 catch {
  const text=decoded.toString('utf8');
  if(!/^[A-Za-z0-9+/=\r\n]+$/.test(text))throw Error('CERTIFICATE_RESPONSE_INVALID');
  try {cert=new X509Certificate(Buffer.from(text,'base64'));}catch{throw Error('CERTIFICATE_RESPONSE_INVALID');}
 }
 const key=cert.publicKey.export({format:'der',type:'spki'});
 if(!key.equals(expectedSpki))throw Error('AUTHORITY_CERTIFICATE_KEY_MISMATCH');
 const now=Date.now();if(now<Date.parse(cert.validFrom)||now>Date.parse(cert.validTo))throw Error('CERTIFICATE_RESPONSE_INVALID');
 return cert;
}

export async function runDeveloperAcceptance() {
 const report:{sourceSha:string|null;environment:string;releaseReady:false;diagnosticPassed:boolean;profile:string;stage:string;checks:unknown[];blocked?:string}={
  sourceSha:process.env.VERCEL_GIT_COMMIT_SHA??null,environment:'DEVELOPER_PORTAL',releaseReady:false,
  diagnosticPassed:false,profile:'SDK_345_SYNTHETIC_QA_ONLY',stage:'target',checks:[]};
 const publish=async()=>{await mkdir('public',{recursive:true});await writeFile('public/acceptance.json',JSON.stringify(report,null,2)+'\n');};
 const known=new Set(['QA_TARGET_REQUIRED','QA_IDENTITY_REQUIRED','KMS_METADATA_INVALID','CSR_SIGNATURE_FAILED',
  'COMPLIANCE_CREDENTIALS_UNAVAILABLE','CERTIFICATE_RESPONSE_INVALID','AUTHORITY_CERTIFICATE_KEY_MISMATCH',
  'COMPLIANCE_MATRIX_NOT_PASSED','PERMANENT_TEST_CREDENTIALS_UNAVAILABLE','KMS_KEY_CHANGED','DELIVERY_MATRIX_NOT_PASSED']);
 try {
  assertDeveloperAcceptanceTarget(process.env);
  const region=process.env.FATOORA_QA_AWS_REGION!,roleArn=process.env.FATOORA_QA_AWS_ROLE_ARN!,keyArn=process.env.FATOORA_QA_KMS_KEY_ARN!;
  const kms=new KMSClient({region,credentials:awsCredentialsProvider({roleArn}),maxAttempts:1});
  const fetchKey=async()=>{
   const k=await kms.send(new GetPublicKeyCommand({KeyId:keyArn}));
   if(k.KeyId!==keyArn||k.KeySpec!=='ECC_SECG_P256K1'||k.KeyUsage!=='SIGN_VERIFY'
    ||!k.SigningAlgorithms?.includes('ECDSA_SHA_256')||!k.PublicKey)throw Error('KMS_METADATA_INVALID');
   return Buffer.from(k.PublicKey);
  };
  report.stage='kms';const spki=await fetchKey();createPublicKey({key:spki,format:'der',type:'spki'});
  const sign=async(bytes:Buffer)=>{
   const r=await kms.send(new SignCommand({KeyId:keyArn,Message:bytes,MessageType:'RAW',SigningAlgorithm:'ECDSA_SHA_256'}));
   if(r.KeyId!==keyArn||r.SigningAlgorithm!=='ECDSA_SHA_256'||!r.Signature)throw Error('CSR_SIGNATURE_FAILED');
   return Buffer.from(r.Signature);
  };
  const api=async(path:'/compliance'|'/compliance/invoices'|'/production/csids'|'/invoices/reporting/single'|'/invoices/clearance/single',body:unknown,authorization?:string)=>{
   const response=await fetch(base+path,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',accept:'application/json','Accept-Version':'V2',
    ...(path==='/compliance'?{OTP:'123345'}:{}),...(authorization?{Authorization:authorization}:{}),
    ...(path==='/invoices/clearance/single'?{'Clearance-Status':'1'}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
   return {http:response.status,body:await response.json().catch(()=>null)};
  };
  report.stage='csr';const csr=await createZatcaDeveloperSandboxCsr({commonName:'TST-886431145-399999999900003',taxpayerVatNumber:'399999999900003',
   branchName:'Riyadh QA Branch',organizationName:'شركة اختبار يقين',serialNumber:`1-YaqeenQA|2-1.0|3-${randomUUID()}`,
   invoiceType:'1100',registeredAddress:'RRRD2929',businessCategory:'Software'},spki,sign);
  report.stage='compliance-csid';const enrollment=await api('/compliance',{csr:Buffer.from(csr).toString('base64')});
  const issued=enrollment.body;
  if(enrollment.http!==200||typeof issued?.binarySecurityToken!=='string'||typeof issued?.secret!=='string'
   ||!/^[0-9]{1,30}$/.test(String(issued.requestID)))throw Error('COMPLIANCE_CREDENTIALS_UNAVAILABLE');
  const cert=certificateMatchesKey(issued.binarySecurityToken,spki);
  const auth='Basic '+Buffer.from(issued.binarySecurityToken+':'+issued.secret).toString('base64');
  report.checks.push({check:'compliance-csid',http:enrollment.http,keyMatched:true});
  let previous=Buffer.from(createHash('sha256').update('0').digest('hex')).toString('base64'),counter=0;
  const createArtifact=async(category:'STANDARD'|'SIMPLIFIED',document:'INVOICE'|'CREDIT_NOTE'|'DEBIT_NOTE',certificate:X509Certificate)=>{
   counter++;
   const issuedAt=new Date(Date.now()-60_000).toISOString(),date=issuedAt.slice(0,10),time=issuedAt.slice(11,19);
   const draft={organization_id:'a800b1c2-df4a-4a79-9b91-4a451ce2858a',invoice_number:`SYNTHETIC-QA-${counter}`,invoice_category:category,document_type:document,
    issue_date:date,issue_time:time,seller_name:'شركة اختبار يقين',seller_vat_number:'399999999900003',seller_address:'King Fahd Road',
    seller_building_number:'1234',seller_district:'Olaya',seller_additional_number:'5678',seller_postal_code:'12345',seller_city:'Riyadh',
    ...(category==='STANDARD'?{buyer_name:'Synthetic Buyer',buyer_vat_number:'399999999800003',buyer_address:'Customer street',buyer_building_number:'4321',buyer_district:'Olaya',buyer_city:'Riyadh',buyer_postal_code:'54321'}:{}),
    ...(document==='INVOICE'?{}:{billing_reference:'SYNTHETIC-ORIGINAL',note_reason:'QA correction'}),
    lines:[{item_name:'Consulting service',quantity:2,unit_price:100,tax_category:'S',tax_rate:15}]};
   const context={invoiceUuid:randomUUID(),invoiceCounter:String(counter),previousInvoiceHash:previous,supplyDate:date,sellerId:{scheme:'CRN',value:'1010000000'},paymentMeansCode:'30'};
   const unsigned=buildUnsignedZatcaXml(draft,context);
   const prepared=category==='SIMPLIFIED'?await prepareZatcaSdk345QaDocument(draft,context,{certificate:certificate.toString(),
    fingerprintSha256:createHash('sha256').update(certificate.raw).digest('hex'),signingTime:new Date()},sign)
    :{xml:unsigned.xml,invoiceHashBase64:(await prepareZatcaInvoiceHash(unsigned.xml)).invoiceHashBase64,uuid:context.invoiceUuid};
   const payload={invoiceHash:prepared.invoiceHashBase64,uuid:prepared.uuid,invoice:Buffer.from(prepared.xml).toString('base64')};
   previous=prepared.invoiceHashBase64;
   return {category,document,payload};
  };
  for(const category of ['STANDARD','SIMPLIFIED'] as const)for(const document of ['INVOICE','CREDIT_NOTE','DEBIT_NOTE'] as const){
   report.stage='compliance-'+category+'-'+document;
   const artifact=await createArtifact(category,document,cert);
   const result=await api('/compliance/invoices',artifact.payload,auth);
   report.checks.push({category,document,...summarizeDeveloperResult(result.http,result.body,'compliance')});
   await publish();
  }
  if(!(await fetchKey()).equals(spki))throw Error('KMS_KEY_CHANGED');
  if(report.checks.slice(1).some(x=>!(x as {passed:boolean}).passed))throw Error('COMPLIANCE_MATRIX_NOT_PASSED');
  report.stage='permanent-developer-csid';const permanent=await api('/production/csids',{compliance_request_id:String(issued.requestID)},auth);
  if(permanent.http!==200||typeof permanent.body?.binarySecurityToken!=='string'||typeof permanent.body?.secret!=='string')throw Error('PERMANENT_TEST_CREDENTIALS_UNAVAILABLE');
  // The path name is the Developer Portal's test API, never the production environment.
  const permanentCert=certificateMatchesKey(permanent.body.binarySecurityToken,spki);
  report.checks.push({check:'permanent-developer-csid',http:permanent.http,keyMatched:true});
  const permanentAuth='Basic '+Buffer.from(permanent.body.binarySecurityToken+':'+permanent.body.secret).toString('base64');
  const deliveries:DeliveryResult[]=[];
  // CCSID-signed compliance samples must not be reused for PCSID reporting.
  // Build fresh diagnostic documents with the permanent certificate, unique
  // UUIDs/counters and the next previous-hash links; never patch signed XML.
  for(const category of ['STANDARD','SIMPLIFIED'] as const)for(const document of ['INVOICE','CREDIT_NOTE','DEBIT_NOTE'] as const){
   const operation=category==='SIMPLIFIED'?'reporting':'clearance';report.stage=operation;
   const artifact=await createArtifact(category,document,permanentCert);
   const result=await api(operation==='reporting'?'/invoices/reporting/single':'/invoices/clearance/single',artifact.payload,permanentAuth);
   const delivery:DeliveryResult={category:artifact.category,document:artifact.document,operation,...summarizeDeveloperResult(result.http,result.body,operation)};
   deliveries.push(delivery);report.checks.push(delivery);
   await publish();
  }
  if(!developerDeliveryMatrixPassed(deliveries))throw Error('DELIVERY_MATRIX_NOT_PASSED');
  report.diagnosticPassed=true;report.stage='diagnostic-complete';
 }catch(error){report.blocked=error instanceof Error&&known.has(error.message)?error.message:'QA_DIAGNOSTIC_FAILED';}
 await publish();
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.argv.includes('--developer-only'))throw Error('EXPLICIT_DEVELOPER_DIAGNOSTIC_REQUIRED');
 await runDeveloperAcceptance();
}
