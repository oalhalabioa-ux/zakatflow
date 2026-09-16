const OUNCE_GRAMS=31.1034768;
type Metal='GOLD'|'SILVER';
type RefPrice={metal:Metal;pricePerGram:number;currency:'SAR';valuationDate:string;source:string;asOf?:string};

async function getJson(url:string){
  try{const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)return null;return await r.json();}catch{return null;}
}
function positive(...values:any[]){for(const v of values){const n=Number(v);if(Number.isFinite(n)&&n>0)return n;}return 0;}

export async function fetchReferenceMetalPrices(valuationDate:string):Promise<RefPrice[]>{
  const today=new Date().toISOString().slice(0,10);
  if(valuationDate===today){
    const j:any=await getJson('https://xaus.com/api/v1/spot?currency=SAR&unit=gram');
    if(j){const rows:RefPrice[]=[];
      const gold=positive(j?.xau?.price,j?.gold?.price,j?.XAU?.price),silver=positive(j?.xag?.price,j?.silver?.price,j?.XAG?.price);
      if(gold>0)rows.push({metal:'GOLD',pricePerGram:gold,currency:'SAR',valuationDate,source:'XAUS',asOf:j?.data_state?.as_of??j?.updated_at});
      if(silver>0)rows.push({metal:'SILVER',pricePerGram:silver,currency:'SAR',valuationDate,source:'XAUS',asOf:j?.data_state?.as_of??j?.updated_at});
      if(rows.length)return rows;
    }
  }
  const j:any=await getJson('https://xaus.com/api/v1/history');
  if(!j)throw new Error('REFERENCE_PRICE_PROVIDER_UNAVAILABLE');
  const points=Array.isArray(j?.points)?j.points:Array.isArray(j?.data)?j.data:[];
  const point=points.find((p:any)=>p?.d===valuationDate||p?.date===valuationDate);
  if(!point)throw new Error('REFERENCE_PRICE_NOT_FOUND');
  const usdPerOz=positive(point?.c,point?.close,point?.price);if(!(usdPerOz>0))throw new Error('REFERENCE_PRICE_NOT_FOUND');
  return [{metal:'GOLD',pricePerGram:(usdPerOz/OUNCE_GRAMS)*3.75,currency:'SAR',valuationDate,source:'XAUS_HISTORY',asOf:valuationDate}];
}
