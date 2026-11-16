/** Only the fictional, read-only review screen is public on its scoped Preview. */
export function isFiscalReviewRequest(path:string,environment:Record<string,string|undefined>){
 return environment.VERCEL_ENV==='preview'&&environment.FISCAL_YEAR_REVIEW_PREVIEW==='true'&&/^\/(ar|en)\/preview\/fiscal-years\/?$/.test(path);
}
