import {notFound} from 'next/navigation';
import CorporateShell from '../../../../components/CorporateShell';
import ZakatWorkspaceTabs from '../../../../components/ZakatWorkspaceTabs';
import CorporateAssetsOverview from '../../../../components/CorporateAssetsOverview';
import {DisplayCurrencyProvider} from '../../../../components/DisplayCurrency';
import {organizationAssetDashboard} from '../../../../lib/organization-assets-dashboard';
import type {RegisterData,RegisterAsset} from '../../../../lib/financial-register';
import '../../../corporate.css';
import '../../../yaqeen-theme.css';
import '../../../yaqeen-dashboard.css';
import '../../../yaqeen-assets.css';
import '../../../yaqeen-controls.css';
import '../../../sidebar-brand.css';
import '../../../[locale]/assets/dashboard/organization-assets.css';
export const metadata={title:'Corporate assets design review',robots:{index:false,follow:false}};
const assets:Array<Pick<RegisterAsset,'name'|'type'|'cost'|'market'|'category'>>=[
 {name:'مبنى المقر الرئيسي',type:'BUILDING',cost:8500000,market:9200000,category:'ASSET'},
 {name:'معدات الإنتاج',type:'MACHINERY',cost:2100000,market:2350000,category:'ASSET'},
 {name:'رخصة برمجيات ERP',type:'SOFTWARE',cost:1250000,market:1250000,category:'ASSET'},
 {name:'وديعة استثمارية',type:'BOND',cost:3000000,market:3100000,category:'INVESTMENT'},
 {name:'مخزون البضائع',type:'INVENTORY',cost:600000,market:650000,category:'ASSET'},
 ...Array.from({length:8},(_,i)=>({name:`تجهيزات الفرع ${i+1}`,type:'FURNITURE',cost:25000,market:23000,category:'ASSET' as const})),
];
const demo:RegisterData={asOf:'2026-10-24',baseCurrency:'SAR',organizations:[],organizationIds:['review-company'],entities:[{id:'review-center',name:'الإدارة العامة',organization_id:'review-company'}],accounts:[{id:'review-cash',name:'حساب توضيحي',type:'BANK',currency:'SAR',nativeCurrency:'SAR',balance:250000,restricted:0,uncleared:0,baseCurrency:'SAR',baseBalance:250000,organizationId:'review-company',entityId:null,source:'LIQUIDITY',openingDate:null}],debts:[{id:'review-ar',partyKey:'review',partyName:'عميل توضيحي',organizationId:'review-company',entityId:null,side:'RECEIVABLE',currency:'SAR',amount:110000,dueDate:null,date:'2026-10-24',description:'رصيد توضيحي',source:'CORE',eventId:null}],assets:assets.map((a,i)=>({...a,id:`review-asset-${i}`,currency:'SAR',organizationId:'review-company',entityId:'review-center',source:'ASSET_REGISTER'})),cashMovements:[],debtMovements:[],warnings:[]};
export default async function Page({searchParams}:{searchParams:Promise<{lang?:string;view?:string;w?:string}>}){
 if(process.env.NODE_ENV==='production'&&process.env.VERCEL_ENV!=='preview')notFound();
 const q=await searchParams,locale=q.lang==='en'?'en':'ar',ar=locale==='ar';
 if(q.view==='responsive'){const width=[320,390,820,1280].includes(Number(q.w))?Number(q.w):390;return <main style={{padding:12,background:'#e8edf4',minHeight:'100vh',textAlign:'center'}}><h1 style={{fontSize:16}}>Corporate asset viewport · {width}px</h1><iframe title="Corporate assets viewport" src={`?lang=${locale}&scope=ORGANIZATION`} width={width} height={844} style={{display:'block',margin:'12px auto',border:0,maxWidth:'100%',background:'#fff'}}/></main>}
 return <DisplayCurrencyProvider locale={locale}><CorporateShell locale={locale}><ZakatWorkspaceTabs locale={locale}/><section className="container org-assets-dashboard"><p className="notice">{ar?'معاينة تصميم فقط · بيانات توضيحية · لا عمليات مالية':'DESIGN REVIEW ONLY · SYNTHETIC DATA · NO FINANCIAL ACTIONS'}</p><header className="page-head"><div><h1>{ar?'الأصول والاستثمارات':'Assets and investments'}</h1><p className="muted">{ar?'شركة توضيحية · الشركة وفروعها':'Sample company · Company and subsidiaries'}</p></div></header><CorporateAssetsOverview summary={organizationAssetDashboard(demo)[0]} locale={locale} entities={demo.entities}/></section></CorporateShell></DisplayCurrencyProvider>;
}
