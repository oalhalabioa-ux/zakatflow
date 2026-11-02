import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import FinancingLoansTable from '../../components/FinancingLoansTable';
import '../../app/corporate.css';
import '../../app/yaqeen-theme.css';

const query=new URLSearchParams(location.search),locale=query.get('locale')??'ar',theme=query.get('theme')??'yaqeen-business';
const records=Array.from({length:35},(_,i)=>({id:'contract-'+i,counterparty_id:'party-'+i,kind:'LOAN',principal:(35-i)*10000,currency:'SAR',base_currency:'SAR',status:i%3===0?'COMMITTED':'ACTUAL',side:i%2?'PAYABLE':'RECEIVABLE',description:i===0?'تمويل رأس المال العامل لدعم توسع الأعمال':'قرض استثماري '+i,reference:'REF-'+(35-i),voucher_number:'FN-'+String(i+1).padStart(4,'0')+'-26',organization_name:'المؤسسة التجريبية',financing:{product:'FINANCING'}}));
const parties=new Map(records.map((c,i)=>[c.counterparty_id,i===0?'بنك البلاد – تمويل دعم الأعمال':'جهة التمويل '+String(i).padStart(2,'0')]));
const facts=new Map(records.map((c,i)=>[c.id,{label:'غير مسدد',outstanding:35000-i*1000,applied:0,overdue:0,nextDue:i%3?new Date(Date.UTC(2026,11,i+1)).toISOString().slice(0,10):null}]));
const money=(v:number|string,ccy:string)=><span dir="ltr">{new Intl.NumberFormat('en-US',{minimumFractionDigits:2}).format(Number(v))} {ccy}</span>;
function Fixture(){const [page,setPage]=useState(0),[opened,setOpened]=useState('');return <div className={'corp-shell theme-'+theme} dir={locale==='ar'?'rtl':'ltr'} style={{display:'block',minHeight:0,padding:16}}><main className="corp-content"><section className="finance-workspace debt-finance-workspace"><h1>{locale==='ar'?'قرض بعائد':'Interest-bearing loans'}</h1><FinancingLoansTable records={records} parties={parties} facts={facts} base="SAR" group={false} locale={locale} page={page} onPageChange={setPage} money={money} sortMoney={value=>Number(value)} onOpen={setOpened}/><div><button onClick={()=>setPage(p=>p-1)} disabled={!page}>Previous</button><output data-page>{page+1}</output><button onClick={()=>setPage(p=>p+1)} disabled={page>=1}>Next</button><output data-opened>{opened}</output></div></section></main></div>}
createRoot(document.getElementById('root')!).render(<Fixture/>);
