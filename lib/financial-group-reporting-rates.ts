/** Reviewed extract of SAMA's fixed September 2026 publication, table 2b.
 * Month-end observations only. The monthly average table is a different series.
 */
export const samaGroupRatePublication={
 publisher:'Saudi Central Bank',
 version:'SAMA_2026_09_TABLE_2B',
 sourceUrl:'https://www.sama.gov.sa/ar-sa/Statistics/MonthlyStatistics/Monthly_Statistical_Bulletin_For_Sep_2026.pdf',
} as const;

const observations:Readonly<Record<string,Readonly<Record<string,string>>>>={
 '2025-12-31':{EUR:'4.4063',GBP:'5.0458',USD:'3.7500'},
 '2026-01-31':{EUR:'4.4708',GBP:'5.1686',USD:'3.7500'},
 '2026-02-28':{EUR:'4.4297',GBP:'5.0537',USD:'3.7500'},
 '2026-03-31':{EUR:'4.3117',GBP:'4.9495',USD:'3.7500'},
 '2026-04-30':{EUR:'4.3883',GBP:'5.0730',USD:'3.7500'},
 '2026-05-31':{EUR:'4.3600',GBP:'5.0240',USD:'3.7500'},
 '2026-06-30':{EUR:'4.2727',GBP:'4.9633',USD:'3.7500'},
 '2026-07-31':{EUR:'4.2976',GBP:'5.0305',USD:'3.7500'},
 '2026-08-31':{EUR:'4.3485',GBP:'5.0771',USD:'3.7500'},
 '2026-09-30':{EUR:'4.2581',GBP:'4.9839',USD:'3.7500'},
};

export type GroupRatePolicy={
 organizationId:string;functionalCurrency:string;presentationCurrency:string;
 effectiveFrom:string;effectiveTo:string;status:'APPROVED'|'DRAFT'|'REVOKED';
 reference:string;publication:string;
};

export function approvedGroupReportingRate(
 policies:readonly GroupRatePolicy[],organizationId:string,from:string,to:string,date:string,
){
 if(from===to)return groupReportingRate(from,to,date);
 const eligible=policies.filter(p=>p.organizationId===organizationId&&p.functionalCurrency===from&&p.presentationCurrency===to&&
  p.effectiveFrom<=date&&p.effectiveTo>=date);
 const policy=eligible[0];
 if(eligible.length!==1||policy.status!=='APPROVED'||!policy.reference.trim()||policy.publication!==samaGroupRatePublication.version)
  throw Error('GROUP_FX_RATE_POLICY_NOT_APPROVED:'+organizationId+':'+from+'/'+to+':'+date);
 return {...groupReportingRate(from,to,date),policyReference:policy.reference};
}

export function groupReportingRate(fromCurrency:string,toCurrency:string,date:string){
 if(toCurrency!=='SAR')throw Error('GROUP_FX_PUBLISHED_RATE_REQUIRED:'+fromCurrency+'/'+toCurrency+':'+date);
 if(fromCurrency===toCurrency)return {date,fromCurrency,toCurrency,rate:'1',reference:'SAME_CURRENCY',sourceUrl:null};
 const rates=Object.hasOwn(observations,date)?observations[date]:undefined;
 const rate=rates&&Object.hasOwn(rates,fromCurrency)?rates[fromCurrency]:undefined;
 if(!rate)throw Error('GROUP_FX_PUBLISHED_RATE_REQUIRED:'+fromCurrency+'/'+toCurrency+':'+date);
 return {date,fromCurrency,toCurrency,rate,reference:samaGroupRatePublication.version,
  sourceUrl:samaGroupRatePublication.sourceUrl};
}
