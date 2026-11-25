'use client';
import type {ReportScopeSelection} from '../lib/operational-report-scope';
import {sourceVoucher} from '../lib/source-voucher';
import {organizationScopeIds,requestedOrganization,rememberedOrganization} from '../lib/workspace-organization';
import WorkspaceOrganizationPicker from './WorkspaceOrganizationPicker';
import TopbarOrganizationControls from './TopbarOrganizationControls';
import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {useWorkspaceScope} from '@/hooks/useWorkspaceScope';
import {useAssetRealizedProfit} from '@/hooks/useAssetRealizedProfit';
import {assetTableStorageKey, readAssetTablePreferences, sortAssetRows} from '@/lib/asset-table-preferences';
import {AssetRealizedProfit, AssetRealizedProfitNote, realizedProfitBasis, realizedProfitText} from './assets/AssetRealizedProfit';
import ActionButton,{ActionIconGlyph} from './ActionButton';
import {CurrencyScope,Money} from './DisplayCurrency';
import DetailsDialog from './assets/DetailsDialog';
import AssetPurchasePanel from './assets/AssetPurchasePanel';
import {filterReportAssets,filterReportMovements,postedReportMovements,assetReportValuation,reportAssetTotals,assetReportState,isRecognizedAsset} from '@/lib/asset-reports';
import {operationExportRows,operationFilteredSummary,operationReportState,operationStateLabel,operationTypeLabel} from '@/lib/asset-operation-report';
import {vatReportPrintHtml} from '@/lib/vat-report-print';
import {reportCsv} from '@/lib/vat-financial-reports';
type Tab='register'|'movements'|'valuation'|'depreciation'|'zakat';
type Column={key:string;label:string;money?:boolean};
export default function AssetFinancialReports({locale,onScopeSelection}:{locale:string;onScopeSelection?:(selection:ReportScopeSelection)=>void}){
 const ar=locale==='ar',t=(a:string,e:string)=>ar?a:e;
 const [scope]=useWorkspaceScope();
 useEffect(()=>{setEntity('');setSelected(null)},[scope]);
 const [assets,setAssets]=useState<any[]>([]),[operations,setOperations]=useState<any[]>([]),[catalog,setCatalog]=useState<any>({organizations:[],entities:[],classes:[]}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[org,setOrg]=useState(''),[group,setGroup]=useState(false),[entity,setEntity]=useState(''),[query,setQuery]=useState(''),[category,setCategory]=useState(''),[status,setStatus]=useState(''),[tab,setTab]=useState<Tab>('register'),[from,setFrom]=useState(''),[to,setTo]=useState(''),[selected,setSelected]=useState<any>(null),[hidden,setHidden]=useState<string[]>([]),[sort,setSort]=useState({key:'name',descending:false}),[stamp,setStamp]=useState('');
 useEffect(()=>{const controller=new AbortController();async function load(){try{const data=await Promise.all(['/api/assets','/api/transactions','/api/assets/catalog'].map(async url=>{const r=await fetch(url,{signal:controller.signal,cache:'no-store'});if(!r.ok)throw new Error(t('تعذر تحميل بيانات التقارير','Unable to load report data'));return r.json();}));if(controller.signal.aborted)return;setAssets(data[0]);setOperations(data[1]);setCatalog(data[2]);const q=new URLSearchParams(window.location.search);setOrg(requestedOrganization(data[2].organizations,q.get('organization')??q.get('organization_id'),rememberedOrganization())?.id??'');setStamp(new Date().toLocaleString(ar?'ar-SA':'en-GB',{timeZone:'Asia/Riyadh'}));}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'REPORT_LOAD_FAILED');}finally{if(!controller.signal.aborted)setLoading(false);}}void load();return()=>controller.abort();},[ar]);
 useEffect(()=>{onScopeSelection?.({scope,organization:scope==='ORGANIZATION'?org:'',group:scope==='ORGANIZATION'&&group,entity:scope==='ORGANIZATION'?entity:''})},[scope,org,group,entity,onScopeSelection]);
 const filtered=useMemo(()=>filterReportAssets(assets,{scope,organizationId:org,organizationIds:[...organizationScopeIds(catalog.organizations,org,group)],entityId:entity,query,category,status}),[assets,scope,org,group,catalog.organizations,entity,query,category,status]);
 const movements=useMemo(()=>filterReportMovements(operations,filtered,from,to),[operations,filtered,from,to]);
 const valuationDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const totals=useMemo(()=>reportAssetTotals(filtered,valuationDate),[filtered,valuationDate]);
 const base=scope==='ORGANIZATION'?catalog.organizations.find((o:any)=>o.id===org)?.base_currency??'SAR':catalog.base_currency??'SAR';
 const tabs:Array<[Tab,string,string]>=[['register','سجل الأصول','Asset register'],['movements','حركات الأصول','Asset movements'],['valuation','التقييم','Valuation'],['depreciation','الإهلاك','Depreciation'],['zakat','الأصول والزكاة','Assets and zakat']];
 const className=(a:any)=>{const key=a.asset_class_code??a.asset_type;const c=catalog.classes.find((x:any)=>x.code===key);const legacy:Record<string,string>={GOLD:t('الذهب','Gold'),SILVER:t('الفضة','Silver'),BANK:t('الحسابات البنكية','Bank accounts'),CASH:t('النقد','Cash'),INVENTORY:t('المخزون','Inventory'),REAL_ESTATE:t('العقارات','Real estate'),STOCKS:t('الأسهم','Stocks')};return c?.[ar?'name_ar':'name_en']??legacy[key]??key;};
 const columns:Column[]=tab==='movements'||tab==='depreciation'?[{key:'voucherType',label:t('نوع السند','Voucher type')},{key:'voucherNumber',label:t('رقم السند','Voucher number')},{key:'date',label:t('التاريخ','Date')},{key:'name',label:t('الأصل','Asset')},{key:'type',label:t('الحركة','Movement')},{key:'quantity',label:t('الكمية','Quantity')},{key:'value',label:t('الأثر الدفتري','Book effect'),money:true},{key:'currency',label:t('العملة','Currency')},{key:'status',label:t('الحالة','Status')}]:[{key:'name',label:t('الأصل','Asset')},{key:'category',label:t('التصنيف','Class')},{key:'date',label:tab==='valuation'?t('تاريخ التقييم','Valuation date'):t('تاريخ الاقتناء','Acquisition date')},...(tab==='valuation'?[{key:'source',label:t('مصدر التقييم','Valuation source')},{key:'fx',label:t('تحويل التقييم','Valuation FX')}]:[]),...(tab==='zakat'?[{key:'eligible',label:t('الوعاء في آخر احتساب','Latest assessed base'),money:true},{key:'zakat',label:t('الزكاة المحتسبة','Assessed zakat'),money:true},{key:'assessment',label:t('تاريخ الاحتساب','Assessment date')}]:[{key:'cost',label:t('القيمة الدفترية الحالية','Current book value'),money:true},{key:'market',label:t('القيمة السوقية','Market value'),money:true},{key:'gain',label:t('فرق التقييم','Valuation difference'),money:true},{key:'percent',label:t('الفرق %','Difference %')}]),{key:'currency',label:t('العملة','Currency')},{key:'status',label:t('الحالة','Status')}];
 const movementTab=tab==='movements'||tab==='depreciation';
 const [profitPreference, setProfitPreference] = useState<{scope: typeof scope; show: boolean} | null>(null);
 useEffect(()=>{
  setProfitPreference({scope, show: readAssetTablePreferences(localStorage, scope).visible.realized});
 },[scope]);
 const showRealized = tab === 'register' && profitPreference?.scope === scope && profitPreference.show;
 const profitLabel = t('الأرباح الفعلية (المحققة)', 'Realized profit / loss');
 const realized = useAssetRealizedProfit(showRealized && !loading, scope, assets);
 if (tab === 'register') columns.push({key: 'realized', label: profitLabel});
 function toggleRealized(show: boolean) {
  const preferences = readAssetTablePreferences(localStorage, scope);
  preferences.visible.realized = show;
  localStorage.setItem(assetTableStorageKey(scope), JSON.stringify(preferences));
  setProfitPreference({scope, show});
  if (!show && sort.key === 'realized') setSort({key:'name', descending:false});
 }
 const records=useMemo(()=>{
 const list=movementTab?movements.filter(r=>tab!=='depreciation'||(r.operation_type??r.transaction_type)==='DEPRECIATION').map(r=>({...sourceVoucher('ASSET',r,ar),id:r.id,asset:assets.find(a=>a.id===r.asset_account_id),raw:r,name:r.asset_accounts?.name??'—',date:r.transaction_date,type:operationTypeLabel(r.operation_type??r.transaction_type,ar),quantity:Number(r.quantity??0),value:operationFilteredSummary([r]).net,currency:r.base_currency,status:operationStateLabel(operationReportState(r),ar)})):filtered.map(asset=>{
  const cost=Number(asset.current_cost_value??0),recognized=isRecognizedAsset(asset);
  const valuation=recognized?assetReportValuation(asset,valuationDate):null;
  const gain=valuation?Number(valuation.unrealized):null;
  return {
   id:asset.id,asset,raw:asset,name:asset.name,category:className(asset),
   date:tab==='valuation'?valuation?.quoteDate??'—':asset.metadata?.purchase_date??'—',
   source:valuation?.source??'—',fx:valuation?.fx??'—',cost:recognized?cost:null,
   market:valuation?Number(valuation.value):null,gain,
   percent:gain!=null&&cost>0?Number((gain/cost*100).toFixed(2)):null,
   eligible:recognized?asset.zakat_calculation?.eligible_value??null:null,
   zakat:recognized?asset.zakat_calculation?.zakat_amount??null:null,
   assessment:asset.zakat_calculation?.assessment_date??'—',
   currency:tab==='zakat'?asset.zakat_calculation?.currency??asset.current_value_currency:asset.current_value_currency??asset.currency,
   status:operationStateLabel(assetReportState(asset),ar),
  };
 });
 return list.sort((a:any,b:any)=>{const av=a[sort.key],bv=b[sort.key];const order=typeof av==='number'&&typeof bv==='number'?av-bv:String(av??'').localeCompare(String(bv??''),ar?'ar':'en',{numeric:true});return sort.descending?-order:order;});
 },[movementTab,movements,tab,assets,filtered,sort,ar,catalog.classes,valuationDate,showRealized,realized.rows]);
 const visible=columns.filter(c=>c.key === 'realized' ? showRealized : !hidden.includes(c.key));
 const distributions=useMemo(()=>{
  const groups=new Map<string,{name:string;value:number;currency:string}>();
  for(const asset of filtered.filter(isRecognizedAsset)){
   const valuation=assetReportValuation(asset,valuationDate);
   if(!valuation)continue;
   const currency=asset.current_value_currency??asset.currency,name=className(asset),key=`${currency}:${name}`;
   const group=groups.get(key)??{name,value:0,currency};
   group.value+=Number(valuation.value);
   groups.set(key,group);
  }
  return [...groups.values()].sort((a,b)=>b.value-a.value);
 },[filtered,catalog.classes,ar,valuationDate]);
 const selectedValuation=selected&&isRecognizedAsset(selected)?assetReportValuation(selected,valuationDate):null;
 function exportReport(format:'PDF'|'CSV'){
 const title=tabs.find(x=>x[0]===tab)![ar?1:2];const subtitle=[scope==='ORGANIZATION'?catalog.organizations.find((o:any)=>o.id===org)?.name:t('أصول شخصية','Personal assets'),scope==='ORGANIZATION'?(entity?catalog.entities.find((e:any)=>e.id===entity)?.name:t('كل الفروع','All entities')):'',t('استخراج','Extracted')+': '+stamp,movementTab?`${from||'—'} → ${to||'—'}`:t('رصيد حالي؛ ليس رصيدًا تاريخيًا','Current balance; not a historical balance'),query,category,status,showRealized ? realizedProfitBasis(ar) : ''].filter(Boolean).join(' · ');
 const rows:Array<Array<string|number>>=[visible.map(c=>c.label),...records.map((r:any)=>visible.map(c=>{
  if (c.key !== 'realized') return r[c.key] ?? '—';
  const result = realized.rows?.[r.id];
  return result?.status === 'recorded' ? `${result.amount} ${result.currency}` : realizedProfitText(result, ar);
 }))];
 if(format==='CSV'){const full=movementTab?operationExportRows(records.map(r=>r.raw),ar):rows;const url=URL.createObjectURL(new Blob([reportCsv([[title,subtitle],...full])],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`asset-${tab}.csv`;a.click();URL.revokeObjectURL(url);return;}
 const win=window.open('','_blank');if(!win){setError(t('اسمح بفتح نافذة الطباعة من المتصفح','Allow the browser print window'));return;}win.opener=null;win.document.write(vatReportPrintHtml(title,subtitle,rows[0] as string[],rows.slice(1),ar,getComputedStyle(document.querySelector('.corp-shell')??document.documentElement).getPropertyValue('--brand-primary').trim()).replace('الفواتير والتسويات المعتمدة · المبالغ حسب عملة التقرير','تقارير الأصول · القيم والعملات المسجلة · المسودات مستبعدة من المؤشرات').replace('Posted invoices and settlements · Amounts in report currency','Asset reports · Stored values and currencies · Drafts excluded from indicators'));win.document.close();
 }
 return <section className="asset-reports section" aria-label={t('تقارير الأصول','Asset reports')}><CurrencyScope currency={base} organizationId={scope==='ORGANIZATION'?org:undefined}/>
 <div className="page-head"><div><h2>{t('تقارير الأصول','Asset reports')}</h2><p className="muted">{t('السجل والحركات والتقييم في مساحة واحدة','Register, movements and valuation in one workspace')}</p></div><div className="asset-report-tools"><details><summary className="btn secondary action-button" aria-label={t('طباعة وتصدير','Print and export')} title={t('طباعة وتصدير','Print and export')}><ActionIconGlyph name="print"/></summary><div className="asset-report-export"><ActionButton icon="print" showLabel label="PDF" disabled={loading||Boolean(error)||!records.length||realized.loading||realized.failed} onClick={()=>exportReport('PDF')}/><ActionButton icon="download" showLabel label="CSV" disabled={loading||Boolean(error)||!records.length||realized.loading||realized.failed} onClick={()=>exportReport('CSV')}/></div></details></div></div>
 <div className="card asset-report-filters">{scope==='ORGANIZATION'&&<TopbarOrganizationControls>{scope==='ORGANIZATION'&&<><WorkspaceOrganizationPicker ar={ar} organizations={catalog.organizations} value={org} onChange={id=>{setOrg(id);setEntity('');}} group={group} onGroupChange={value=>{setGroup(value);setEntity('');}}/><label>{t('الفرع','Entity')}<select value={entity} onChange={e=>setEntity(e.target.value)}><option value="">{t('كل الفروع','All entities')}</option>{catalog.entities.filter((e:any)=>e.organization_id===org).map((e:any)=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label></>}</TopbarOrganizationControls>}<label>{t('بحث','Search')}<input value={query} placeholder={t('اسم الأصل أو المرجع','Asset name or reference')} onChange={e=>setQuery(e.target.value)}/></label><details className="asset-report-advanced"><summary><ActionIconGlyph name="filter"/>{t('فلاتر إضافية','More filters')}</summary><div className="asset-report-filters"><label>{t('التصنيف','Class')}<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">{t('كل التصنيفات','All classes')}</option>{[...new Set(assets.map(a=>a.asset_class_code??a.asset_type))].map(key=><option key={key} value={key}>{className({asset_class_code:key})}</option>)}</select></label><label>{t('حالة الاعتراف','Recognition')}<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">{t('كل الحالات','All states')}</option><option value="POSTED">{t('معتمد / مسجل','Posted / recorded')}</option><option value="DRAFT">{t('غير مرحل','Unposted')}</option></select></label><ActionButton icon="reverse" label={t('مسح الفلاتر','Reset filters')} onClick={()=>{setQuery('');setCategory('');setStatus('');setEntity('');setFrom('');setTo('');}}/></div></details></div>
 {error&&<p role="alert" className="card">{error}</p>}{loading?<p role="status">{t('تحميل التقارير…','Loading reports…')}</p>:<>
 <p className="muted asset-report-caption">{t('الرصيد الحالي بتاريخ الاستخراج','Current balance extracted at')}: {stamp} · {t('المعتمد / المسجل','Posted / recorded')}: {totals.recognized} · {t('غير المرحل','Unposted')}: {totals.drafts}</p>
 {totals.groups.map(g=><div className="asset-report-kpis" key={g.currency}>{[[t('القيمة الدفترية الحالية','Current book value'),g.cost],[t('السوق للأصول المقيّمة','Market value of priced assets'),g.market],[t('فرق التقييم للأصول المقيّمة','Valuation difference of priced assets'),g.gain]].map(([label,value])=><div className="card" key={String(label)}><span className="muted">{label}</span><strong>{value==null?'—':<Money value={value} currency={g.currency}/>}</strong></div>)}<div className="card"><span className="muted">{t('فرق التقييم %','Valuation difference %')}</span><strong dir="ltr">{g.percent==null?'—':g.percent.toFixed(2)+'%'}</strong><small>{g.currency} · {g.valued}/{g.count} {t('أصول مقيّمة','assets priced')}</small></div></div>)}
 <div className="asset-report-layout"><div className="card asset-report-main"><nav className="asset-report-tabs" aria-label={t('أنواع تقارير الأصول','Asset report types')}>{tabs.map(([key,label,en])=><ActionButton key={key} icon={key==='movements'?'operations':key==='valuation'?'details':key==='depreciation'?'history':key==='zakat'?'pay':'details'} showLabel label={ar?label:en} aria-pressed={tab===key} onClick={()=>{setTab(key);setHidden([]);setSort({key:'name',descending:false});}}/>)}</nav>
 <div className="asset-report-toolbar"><strong>{tabs.find(x=>x[0]===tab)![ar?1:2]} <span className="pill">{records.length}</span></strong><details><summary className="btn secondary action-button action-with-label"><ActionIconGlyph name="filter"/>{t('الأعمدة','Columns')}</summary><div className="asset-report-column-menu">{columns.map(c=><label key={c.key}><input type="checkbox" checked={c.key === 'realized' ? showRealized : !hidden.includes(c.key)} disabled={['name','currency','voucherType','voucherNumber'].includes(c.key)} onChange={e=>c.key === 'realized' ? toggleRealized(e.target.checked) : setHidden(v=>e.target.checked?v.filter(k=>k!==c.key):[...v,c.key])}/>{c.label}</label>)}</div></details></div>
 {movementTab&&<div className="asset-report-filters"><label>{t('من تاريخ','From')}<input type="date" value={from} max={to||undefined} onChange={e=>setFrom(e.target.value)}/></label><label>{t('إلى تاريخ','To')}<input type="date" value={to} min={from||undefined} onChange={e=>setTo(e.target.value)}/></label><p className="muted">{t('المؤشرات أعلاه لرصيد الأصول الحالي؛ الجدول للحركات ضمن الفترة فقط.','Indicators above show current assets; this table contains only movements in the selected period.')}</p></div>}
 {showRealized&&<AssetRealizedProfitNote ar={ar} loading={realized.loading} failed={realized.failed}/>}
 {tab==='valuation'&&<p className="muted">{t('القيمة السوقية تتطلب سعراً مسجلاً بمصدر وتاريخ وسعر صرف عند اختلاف العملة.','Market value requires a recorded price, source, date, and an exchange rate when the currency differs.')}</p>}
 {tab==='zakat'&&<p className="muted">{t('الأرقام من آخر احتساب محفوظ لكل أصل، وليست احتساب زكاة جديدًا. راجع تاريخ الاحتساب وعملته.','Values come from each asset’s latest saved assessment. Check assessment date and currency.')}</p>}
 <div className="transaction-table-wrap"><table className="table"><thead><tr>{visible.map(c=><th key={c.key} aria-sort={sort.key===c.key?(sort.descending?'descending':'ascending'):'none'}><button className="asset-report-sort" type="button" onClick={()=>setSort(s=>({key:c.key,descending:s.key===c.key?!s.descending:false}))}>{c.label}{sort.key===c.key?(sort.descending?' ↓':' ↑'):''}</button></th>)}<th>{t('التفاصيل','Details')}</th></tr></thead><tbody>{records.map((r:any)=><tr key={r.id}>{visible.map(c=><td key={c.key}>{c.key === 'realized' ? <AssetRealizedProfit result={realized.rows?.[r.id]} ar={ar} organizationId={r.asset?.organization_id}/> : c.money&&r[c.key]!=null?<Money value={r[c.key]} currency={r.currency} organizationId={r.asset?.organization_id}/>:r[c.key]??'—'}</td>)}<td>{r.asset&&<ActionButton icon="details" label={t('تفاصيل الأصل','Asset details')} onClick={()=>setSelected(r.asset)}/>}</td></tr>)}{!records.length&&<tr><td colSpan={visible.length+1}>{t('لا توجد بيانات مطابقة للفلاتر.','No data matches these filters.')}</td></tr>}</tbody></table></div>
 {movementTab&&postedReportMovements(records.map(r=>r.raw)).length>0&&<div className="asset-report-movement-summary">{[...new Set(records.map(r=>r.raw.base_currency))].map(currency=>{const s=operationFilteredSummary(records.map(r=>r.raw).filter(r=>r.base_currency===currency));return <p key={currency}>{t('صافي الأثر الدفتري المرحل في الفترة','Net posted book movement in period')}: <Money value={s.net} currency={currency}/> · {t('غير المرحل','Unposted')}: {s.drafts}</p>;})}</div>}
 </div><aside className="card asset-report-distribution"><h3>{t('توزيع القيم السوقية','Market value distribution')}</h3><p className="muted">{t('الأصول المقيّمة ضمن الفلاتر الحالية','Priced assets within current filters')}</p>{distributions.map(g=>{const total=distributions.filter(x=>x.currency===g.currency).reduce((sum,x)=>sum+Math.max(0,x.value),0),percent=total>0?Math.max(0,g.value)/total*100:0;return <div className="asset-report-bar" key={`${g.currency}:${g.name}`}><span>{g.name}</span><strong><Money value={g.value} currency={g.currency}/></strong><meter min="0" max="100" value={percent} aria-label={`${g.name} ${percent.toFixed(1)}%`}/><small>{percent.toFixed(1)}% · {g.currency}</small></div>;})}{!distributions.length&&<p>{t('لا توجد أسعار سوق موثقة ضمن الفلاتر','No recorded market prices within the filters')}</p>}</aside></div>
 </>}
 {selected&&<DetailsDialog label={t('تفاصيل الأصل','Asset details')} onClose={()=>setSelected(null)}>{selected.financial_event_id?<AssetPurchasePanel assetId={selected.id} ar={ar} onChanged={()=>{window.location.reload();}} onClose={()=>setSelected(null)}/>:<section className="card operation-detail-card"><div className="page-head"><h3>{selected.name}</h3><ActionButton icon="close" label={t('إغلاق','Close')} onClick={()=>setSelected(null)}/></div><dl className="operation-detail-grid"><div><dt>{t('التصنيف','Class')}</dt><dd>{className(selected)}</dd></div><div><dt>{t('القيمة الدفترية الحالية','Current book value')}</dt><dd><Money value={selected.current_cost_value} currency={selected.current_value_currency}/></dd></div><div><dt>{t('القيمة السوقية','Market value')}</dt><dd>{selectedValuation?<Money value={selectedValuation.value} currency={selected.current_value_currency??selected.currency}/>:"—"}</dd></div><div><dt>{t('تاريخ التقييم','Valuation date')}</dt><dd>{selectedValuation?.quoteDate??'—'}</dd></div></dl><div className="asset-details-footer"><Link className="btn secondary action-button action-with-label" title={t('فتح إدارة الأصول','Open asset management')} href={`/${locale}/assets`}><ActionIconGlyph name="details"/>{t('فتح إدارة الأصول','Open asset management')}</Link></div></section>}</DetailsDialog>}
 </section>;
}
