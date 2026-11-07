/** Strict allowlist for same-origin linked financial-setup windows. */
const route=/^\/(?:ar|en)\/(?:settings(?:\/financial\/fiscal-years)?|chart-of-accounts|financial-reporting-policy|cash-and-banks|liquidity|opening-balances|users)$/;
export function setupEmbeddedUrl(href:string,organizationId:string):string|null{
 if(!href.startsWith('/')||href.startsWith('//')||!organizationId)return null;
 try{
  const u=new URL(href,'https://yaqeen.invalid');
  if(u.origin!=='https://yaqeen.invalid'||!route.test(u.pathname)||
   u.searchParams.get('organization')!==organizationId)return null;
  u.searchParams.set('fromSetup','1');u.searchParams.set('setupEmbed','1');
  return u.pathname+u.search;
 }catch{return null}
}
