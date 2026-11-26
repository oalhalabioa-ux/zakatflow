/** Reviewed extract of SAMA's fixed September 2026 publication, table 2b.
 * Month-end observations only. The monthly average table is a different series.
 */
export const samaGroupRatePublication={
 publisher:'Saudi Central Bank',
 version:'SAMA_2026_09_TABLE_2B',
 sourceUrl:'https://www.sama.gov.sa/ar-sa/Statistics/MonthlyStatistics/Monthly_Statistical_Bulletin_For_Sep_2026.pdf',
} as const;

const observations:Readonly<Record<string,Readonly<Record<string,string>>>>={
 '2025-09-30':{AUD:'2.4758',BRL:'0.7052',CNY:'0.5266',JPY:'0.0252',INR:'0.0422',GBP:'5.0391',KRW:'0.0027',USD:'3.7500',EUR:'4.4029',THB:'0.1160',TRY:'0.0901',CHF:'4.7010'},
 '2025-10-31':{AUD:'2.4595',BRL:'0.6974',CNY:'0.5278',JPY:'0.0244',INR:'0.0423',GBP:'4.9292',KRW:'0.0026',USD:'3.7500',EUR:'4.3379',THB:'0.1161',TRY:'0.0891',CHF:'4.6744'},
 '2025-11-30':{AUD:'2.4386',BRL:'0.6985',CNY:'0.5296',JPY:'0.0240',INR:'0.0420',GBP:'4.9388',KRW:'0.0025',USD:'3.7500',EUR:'4.3414',THB:'0.1163',TRY:'0.0882',CHF:'4.6497'},
 '2025-12-31':{AUD:'2.5125',BRL:'0.6816',CNY:'0.5363',JPY:'0.0240',INR:'0.0417',GBP:'5.0458',KRW:'0.0026',USD:'3.7500',EUR:'4.4063',THB:'0.1188',TRY:'0.0873',CHF:'4.7316'},
 '2026-01-31':{AUD:'2.6272',BRL:'0.7173',CNY:'0.5398',JPY:'0.0244',INR:'0.0408',GBP:'5.1686',KRW:'0.0026',USD:'3.7500',EUR:'4.4708',THB:'0.1195',TRY:'0.0864',CHF:'4.8885'},
 '2026-02-28':{AUD:'2.6739',BRL:'0.7288',CNY:'0.5474',JPY:'0.0241',INR:'0.0413',GBP:'5.0537',KRW:'0.0026',USD:'3.7500',EUR:'4.4297',THB:'0.1208',TRY:'0.0855',CHF:'4.8593'},
 '2026-03-31':{AUD:'2.5669',BRL:'0.7186',CNY:'0.5430',JPY:'0.0235',INR:'0.0396',GBP:'4.9495',KRW:'0.0025',USD:'3.7500',EUR:'4.3117',THB:'0.1140',TRY:'0.0844',CHF:'4.6816'},
 '2026-04-30':{AUD:'2.6674',BRL:'0.7518',CNY:'0.5487',JPY:'0.0234',INR:'0.0394',GBP:'5.0730',KRW:'0.0025',USD:'3.7500',EUR:'4.3883',THB:'0.1144',TRY:'0.0834',CHF:'4.7728'},
 '2026-05-31':{AUD:'2.6825',BRL:'0.7405',CNY:'0.5532',JPY:'0.0235',INR:'0.0391',GBP:'5.0240',KRW:'0.0025',USD:'3.7500',EUR:'4.3600',THB:'0.1149',TRY:'0.0817',CHF:'4.7821'},
 '2026-06-30':{AUD:'2.5759',BRL:'0.7245',CNY:'0.5527',JPY:'0.0231',INR:'0.0396',GBP:'4.9633',KRW:'0.0024',USD:'3.7500',EUR:'4.2727',THB:'0.1129',TRY:'0.0805',CHF:'4.6359'},
 '2026-07-31':{AUD:'2.6306',BRL:'0.7392',CNY:'0.5546',JPY:'0.0233',INR:'0.0392',GBP:'5.0305',KRW:'0.0026',USD:'3.7500',EUR:'4.2976',THB:'0.1120',TRY:'0.0792',CHF:'4.6254'},
 '2026-08-31':{AUD:'2.6872',BRL:'0.7238',CNY:'0.5581',JPY:'0.0234',INR:'0.0393',GBP:'5.0771',KRW:'0.0027',USD:'3.7500',EUR:'4.3485',THB:'0.1132',TRY:'0.0779',CHF:'4.6372'},
 '2026-09-30':{AUD:'2.6164',BRL:'0.7239',CNY:'0.5593',JPY:'0.0238',INR:'0.0391',GBP:'4.9839',KRW:'0.0028',USD:'3.7500',EUR:'4.2581',THB:'0.1118',TRY:'0.0766',CHF:'4.4963'},
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
 if(fromCurrency===toCurrency&&/^[A-Z]{3}$/.test(fromCurrency))
  return {date,fromCurrency,toCurrency,rate:'1',reference:'SAME_CURRENCY',sourceUrl:null};
 const rate=publishedGroupRate(fromCurrency,toCurrency,date);
 if(!rate)throw Error('GROUP_FX_PUBLISHED_RATE_REQUIRED:'+fromCurrency+'/'+toCurrency+':'+date);
 return {date,fromCurrency,toCurrency,rate,reference:samaGroupRatePublication.version,
  sourceUrl:samaGroupRatePublication.sourceUrl};
}

/** Coverage check for authorized group diagnostics. Publication availability does not confer approval. */
export function publishedGroupRate(fromCurrency:string,toCurrency:string,date:string){
 const row=toCurrency==='SAR'&&Object.hasOwn(observations,date)?observations[date]:undefined;
 return row&&Object.hasOwn(row,fromCurrency)?row[fromCurrency]:undefined;
}
