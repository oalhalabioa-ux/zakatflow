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
 const passed=validationPassed&&outcomeMatched;
 const reportingOutcome=operation!=='reporting'?undefined:
  passed?'REPORTED_WITHOUT_WARNINGS':
  http===202&&disposition==='REPORTED'&&validation.status==='WARNING'
   &&errors?.length===0&&warnings&&warnings.length>0?'REPORTED_WITH_WARNINGS':
  http===400&&disposition==='NOT_REPORTED'&&validation.status==='ERROR'
   &&errors&&errors.length>0&&warnings!==null?'REJECTED':
  'UNCONFIRMED';
 return {http,validationStatus:['PASS','WARNING','ERROR'].includes(String(validation.status))?String(validation.status):'UNRECOGNIZED',
  disposition:['REPORTED','CLEARED','NOT_REPORTED','NOT_CLEARED'].includes(String(disposition))?String(disposition):null,
  errorCodes:codes(errors),warningCodes:codes(warnings),passed,...(reportingOutcome?{reportingOutcome}:{})};
}
