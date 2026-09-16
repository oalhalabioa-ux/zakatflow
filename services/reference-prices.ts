const OUNCE_GRAMS=31.1034768;
type Metal='GOLD'|'SILVER';
type RefPrice={metal:Metal;pricePerGram:number;currency:'SAR';valuationDate:string;source:string;asOf?:string};

export async function fetchReferenceMetalPrices(valuationDate:string):Promise<RefPrice[]>{
  const today=new Date().toISOString().slice(0,10);
  if(valuationDate===today){
    const r=await fetch('https://xaus.com/api/v1/spot?currency=SAR&unit=gram',{cache:'no-store'});
    if(r.ok){const j:any=await r.json();const rows:RefPrice[]=[];
      const gold=Number(j?.xau?.price??j?.gold?.price??0),silver=Number(j?.xag?.price??j?.silver?.price??0);
      if(gold>0)rows.push({metal:'GOLD',pricePerGram:gold,currency:'SAR',valuationDate,source:'XAUS',asOf:j?.data_state?.as_of??j?.updated_at});
      if(silver>0)rows.push({metal:'SILVER',pricePerGram:silver,currency:'SAR',valuationDate,source:'XAUS',asOf:j?.data_state?.as_of??j?.updated_at});
      if(rows.length)return rows;
    }
  }
  const h=await fetch('https://xaus.com/api/v1/history',{cache:'no-store'});
  if(!h.ok)throw new Error('REFERENCE_PRICE_PROVIDER_UNAVAILABLE');
  const j:any=await h.json();const point=(j?.points??[]).find((p:any)=>p.d===valuationDate||p.date===valuationDate);
  if(!point)throw new Error('REFERENCE_PRICE_NOT_FOUND');
  const usdPerOz=Number(point.c??point.close??0);if(!(usdPerOz>0))throw new Error('REFERENCE_PRICE_NOT_FOUND');
  return [{metal:'GOLD',pricePerGram:(usdPerOz/OUNCE_GRAMS)*3.75,currency:'SAR',valuationDate,source:'XAUS_HISTORY',asOf:valuationDate}];
}
