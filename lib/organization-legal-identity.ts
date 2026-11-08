import {isCountryCode} from './countries';
/** Optional organization legal master fields; never confuse registered address with VAT seller address. */
export type OrganizationLegalInput={country_code?:unknown;commercial_registration_number?:unknown;registered_address?:unknown;activity?:unknown;contact_email?:unknown;contact_phone?:unknown;registered_city?:unknown;registered_region?:unknown;registered_postal_code?:unknown;registration_authority?:unknown;registration_expires_on?:unknown;};

function optionalText(value:unknown,maximum:number,code:string):string|null{
 if(value===null||value===undefined||value==='')return null;
 if(typeof value!=='string')throw Error(code);
 const text=value.trim();
 if(text.length>maximum)throw Error(code);
 return text||null;
}

export function normalizedOrganizationLegalFields(input:OrganizationLegalInput):{
 country_code?:string|null;commercial_registration_number?:string|null;registered_address?:string|null;activity?:string|null;contact_email?:string|null;contact_phone?:string|null;registered_city?:string|null;registered_region?:string|null;registered_postal_code?:string|null;registration_authority?:string|null;registration_expires_on?:string|null;
}{
 const patch:Partial<Record<keyof OrganizationLegalInput,string|null>>={};
 if(Object.prototype.hasOwnProperty.call(input,'country_code')){
  const code=optionalText(input.country_code,2,'ORGANIZATION_COUNTRY_INVALID')?.toUpperCase()??null;
  if(code!==null&&!isCountryCode(code))throw Error('ORGANIZATION_COUNTRY_INVALID');
  patch.country_code=code;
 }
 if(Object.prototype.hasOwnProperty.call(input,'commercial_registration_number'))
  patch.commercial_registration_number=optionalText(input.commercial_registration_number,80,'ORGANIZATION_REGISTRATION_INVALID');
 if(Object.prototype.hasOwnProperty.call(input,'registered_address'))
  patch.registered_address=optionalText(input.registered_address,500,'ORGANIZATION_LEGAL_ADDRESS_INVALID');
 for(const [key,limit] of [['activity',120],['contact_email',254],['contact_phone',40],['registered_city',120],['registered_region',120],['registered_postal_code',20],['registration_authority',160]] as const){
  if(Object.prototype.hasOwnProperty.call(input,key))patch[key]=optionalText(input[key],limit,'ORGANIZATION_PROFILE_INVALID');
 }
 if(patch.contact_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.contact_email))throw Error('ORGANIZATION_EMAIL_INVALID');
 if(Object.prototype.hasOwnProperty.call(input,'registration_expires_on')){
  const date=optionalText(input.registration_expires_on,10,'ORGANIZATION_REGISTRATION_DATE_INVALID');
  if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw Error('ORGANIZATION_REGISTRATION_DATE_INVALID');
  patch.registration_expires_on=date;
 }
 return patch;
}
