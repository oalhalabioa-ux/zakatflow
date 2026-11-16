export type Registration = {name:string;phone:string;password:string;confirm:string;terms:boolean};
export function normalizeEmail(value:string){return value.trim().toLowerCase()}
export function validEmail(value:string){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())}
export function normalizePhone(value:string){return value.replace(/[\s().-]/g,'')}
export function registrationError(email:string,value:Registration){
 if(!validEmail(email))return 'email' as const;
 if(value.name.trim().length<2||value.name.trim().length>120)return 'name' as const;
 if(!/^\+[1-9]\d{6,14}$/.test(normalizePhone(value.phone)))return 'phone' as const;
 if(value.password.length<12||value.password.length>128||!/\p{L}/u.test(value.password)||!/[0-9]/.test(value.password))return 'strength' as const;
 if(value.password!==value.confirm)return 'mismatch' as const;
 if(!value.terms)return 'terms' as const;
 return null;
}
// Never grant a grace-period session: unverified signups remain outside the workspace.
export function verifiedEmail(user:{email_confirmed_at?:string|null}|null){return !!user?.email_confirmed_at}
