/** Optional organization legal master fields; never confuse registered address with VAT seller address. */
export type OrganizationLegalInput={country_code?:unknown;commercial_registration_number?:unknown;registered_address?:unknown};

function optionalText(value:unknown,maximum:number,code:string):string|null{
 if(value===null||value===undefined||value==='')return null;
 if(typeof value!=='string')throw Error(code);
 const text=value.trim();
 if(text.length>maximum)throw Error(code);
 return text||null;
}

export function normalizedOrganizationLegalFields(input:OrganizationLegalInput):{
 country_code?:string|null;commercial_registration_number?:string|null;registered_address?:string|null;
}{
 const patch:{country_code?:string|null;commercial_registration_number?:string|null;registered_address?:string|null}={};
 if(Object.prototype.hasOwnProperty.call(input,'country_code')){
  const code=optionalText(input.country_code,2,'ORGANIZATION_COUNTRY_INVALID')?.toUpperCase()??null;
  if(code!==null&&!/^[A-Z]{2}$/.test(code))throw Error('ORGANIZATION_COUNTRY_INVALID');
  patch.country_code=code;
 }
 if(Object.prototype.hasOwnProperty.call(input,'commercial_registration_number'))
  patch.commercial_registration_number=optionalText(input.commercial_registration_number,80,'ORGANIZATION_REGISTRATION_INVALID');
 if(Object.prototype.hasOwnProperty.call(input,'registered_address'))
  patch.registered_address=optionalText(input.registered_address,500,'ORGANIZATION_LEGAL_ADDRESS_INVALID');
 return patch;
}
