/** Reviewed extract of SAMA's fixed September 2026 publication, table 2b.
 * Month-end observations only. The monthly average table is a different series.
 */
export const samaGroupRatePublication={
 publisher:'Saudi Central Bank',
 version:'SAMA_2026_09_TABLE_2B',
 sourceUrl:'https://www.sama.gov.sa/ar-sa/Statistics/MonthlyStatistics/Monthly_Statistical_Bulletin_For_Sep_2026.pdf',
} as const;

const observations:Readonly<Record<string,Readonly<Record<string,string>>>>={
 '2025-12-31':{EUR:'4.4063',USD:'3.7500'},
 '2026-01-31':{EUR:'4.4708',USD:'3.7500'},
 '2026-02-28':{EUR:'4.4297',USD:'3.7500'},
};

export function groupReportingRate(fromCurrency:string,toCurrency:string,date:string){
 if(toCurrency!=='SAR'||!Object.hasOwn(observations,date))throw Error('GROUP_FX_PUBLISHED_RATE_REQUIRED');
 const rates=observations[date];
 const rate=fromCurrency===toCurrency?'1':Object.hasOwn(rates,fromCurrency)?rates[fromCurrency]:undefined;
 if(!rate)throw Error('GROUP_FX_PUBLISHED_RATE_REQUIRED');
 return {date,fromCurrency,toCurrency,rate,reference:samaGroupRatePublication.version,
  sourceUrl:samaGroupRatePublication.sourceUrl};
}
