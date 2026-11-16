import {notFound} from 'next/navigation';
import CorporateShell from '../../../components/CorporateShell';
import {DisplayCurrencyProvider} from '../../../components/DisplayCurrency';
import PersonalContractsWorkspace from '../../../components/PersonalContractsWorkspace';
import '../../corporate.css';
import '../../yaqeen-theme.css';
import '../../yaqeen-controls.css';
import '../../sidebar-brand.css';
import '../../[locale]/financial-register.css';
import '../../[locale]/debt-finance.css';
import {personalInstallmentBalances,personalContractPlan} from '../../../lib/personal-contracts';
export const metadata={title:'Personal contracts design review',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{w?:string}>}){
 if(process.env.NODE_ENV==='production'&&process.env.VERCEL_ENV!=='preview')notFound();
 const q=await searchParams;if(q.w){const w=[320,390,820].includes(Number(q.w))?Number(q.w):390;return <main style={{padding:12,background:'#eef2f6',minHeight:'100vh'}}><iframe title="معاينة العقود الشخصية على الجوال" src="/design-review/personal-contracts?scope=PERSONAL" width={w} height={844} style={{border:0,display:'block',margin:'auto'}}/></main>}
 const bank='11111111-1111-4111-8111-111111111111',register:any={asOf:'2026-10-26',baseCurrency:'SAR',organizations:[],organizationIds:[],entities:[],assets:[],cashMovements:[],debtMovements:[],debts:[],warnings:[],accounts:[{id:bank,name:'الحساب الشخصي · بيانات تجريبية',nativeCurrency:'SAR',currency:'SAR',balance:25000}]};
 const contracts:any[]=[['QARD','RECEIVABLE','قرض تعليمي · مثال','Q-2026-001',12000,8000],['QARD','PAYABLE','تمويل عائلي · مثال','Q-2026-002',18000,15000],['FINANCING','PAYABLE','تمويل شخصي · مثال','F-2026-001',24000,18000],['PARTICIPATION','RECEIVABLE','شراكة مشروع · مثال','I-2026-001',50000,45000]].map(([product,side,party,reference,principal,outstanding],i)=>{
  const terms:any={product,side,mode:'OPENING',party,reference,description:'بيانات توضيحية لا تمثل عمليات مالية حقيقية',principal,date:'2026-08-01',currency:'SAR',account_id:null,source_id:null,schedule:Array.from({length:4},(_,n)=>({amount:Number(principal)/4,due_date:`2026-${String(n+9).padStart(2,'0')}-01`})),finance:product==='FINANCING'?{annualRate:8,method:'DECLINING',repayment:'EQUAL_PRINCIPAL',frequencyMonths:1,yearDays:365}:null,profit_share:30,zakatable:true};
  const id=`22222222-2222-4222-8222-${String(i+1).padStart(12,'0')}`;
  return {id,product,side,status:'POSTED',revision:1,terms,principal,outstanding,currency:'SAR',asset_id:side==='RECEIVABLE'?id:null,payable_id:side==='PAYABLE'?id:null,created_at:'2026-08-01T09:00:00Z',schedule:personalInstallmentBalances(terms.schedule,Number(principal),Number(outstanding)),plan:personalContractPlan(terms),movements:[{id:'fund-'+i,contract_id:id,kind:'FUND',amount:principal,operation_date:'2026-08-01',notes:'رصيد افتتاحي تجريبي',asset_id:null,payable_id:null,installment_number:null,transaction_ids:[],created_at:'2026-08-01T09:00:00Z',reversed_at:null,outstanding:0},...(Number(principal)>Number(outstanding)?[{id:'settlement-'+i,contract_id:id,kind:'SETTLE',amount:Number(principal)-Number(outstanding),operation_date:'2026-09-05',notes:'تسوية تجريبية لأصل المبلغ',asset_id:null,payable_id:null,installment_number:null,transaction_ids:[],created_at:'2026-09-05T09:00:00Z',reversed_at:null,outstanding:0}]:[])]};
 });
 return <DisplayCurrencyProvider locale="ar"><CorporateShell locale="ar"><PersonalContractsWorkspace locale="ar" previewData={{contracts,register,asOf:register.asOf}}/></CorporateShell></DisplayCurrencyProvider>;
}
