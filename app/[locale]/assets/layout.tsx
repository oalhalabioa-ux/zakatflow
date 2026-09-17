'use client';
import type {ReactNode} from 'react';
import {useParams} from 'next/navigation';
import MetalMarketPriceControl from '@/components/MetalMarketPriceControl';

export default function AssetsLayout({children}:{children:ReactNode}){
  const params=useParams<{locale:string}>();
  const ar=params?.locale==='ar';
  const refresh=()=>{window.location.reload()};
  return <>
    <div className="container" style={{paddingBottom:0}}>
      <section className="card section" style={{marginBottom:0}}>
        <div className="page-head" style={{marginBottom:6}}>
          <div>
            <h3 style={{margin:0}}>{ar?'أسعار السوق الحالية للمعادن':'Current metal market prices'}</h3>
            <p className="muted" style={{margin:'4px 0 0'}}>{ar?'تحديث السعر يعيد تقييم القيمة الحالية للذهب أو الفضة فقط، ولا يغيّر تكلفة الشراء أو الاحتسابات التاريخية.':'Updating a price revalues current gold or silver values only; purchase cost and historical assessments remain unchanged.'}</p>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:10}}>
          <MetalMarketPriceControl type="GOLD" ar={ar} onUpdated={refresh}/>
          <MetalMarketPriceControl type="SILVER" ar={ar} onUpdated={refresh}/>
        </div>
      </section>
    </div>
    {children}
  </>;
}
