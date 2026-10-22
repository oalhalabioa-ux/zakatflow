'use client';
import {useEffect,useRef} from 'react';
import ActionButton from '../ActionButton';
import {Money} from '../DisplayCurrency';
import {vatReportPrintHtml} from '@/lib/vat-report-print';
import {reportCsv} from '@/lib/vat-financial-reports';
import {assetPurchaseStatus} from '@/lib/asset-purchase-workspace';
import AssetOpeningControls from './AssetOpeningControls';
import {isAssetOpeningVoucher} from '@/lib/asset-opening-workspace';
export default function AssetDetails({asset,ar,onClose,onEdit,onLifecycle,onReview,onOpeningChanged}:{asset:any;ar:boolean;onClose:()=>void;onEdit:()=>void;onLifecycle:()=>void;onReview:(id:string)=>void;onOpeningChanged?:()=>void}){
 const ref=useRef<HTMLElement>(null);
 const t=(a:string,e:string)=>ar?a:e;
 const records:Array<[string,string|number]>=[[t('الأصل','Asset'),asset.name],[t('تاريخ الاقتناء','Acquisition date'),asset.metadata?.purchase_date??'—'],[t('الكمية الحالية','Current quantity'),Number(asset.current_quantity??0)],[t('التكلفة الدفترية','Book cost'),Number(asset.current_cost_value??0)],[t('القيمة الحالية','Current value'),Number(asset.current_market_value??0)],[t('العملة الأساسية','Base currency'),asset.current_value_currency??asset.currency],[t('تصنيف الأصل','Asset class'),asset.asset_class_code??asset.asset_type],[t('حالة الأصل','Asset status'),asset.lifecycle_status??'ACTIVE']];
 function print(){const win=window.open('','_blank');if(!win)return;win.opener=null;win.document.write(vatReportPrintHtml(t('كشف الأصل','Asset statement'),asset.name,[t('البند','Field'),t('القيمة','Value')],records,ar,getComputedStyle(document.documentElement).getPropertyValue('--corp-primary').trim()||'#24616f').replace('الفواتير والتسويات المعتمدة · المبالغ حسب عملة التقرير','سجل الأصل · المبالغ بالعملة الأساسية المسجلة').replace('Posted invoices and settlements · Amounts in report currency','Asset record · Stored base currency'));win.document.close();}
 function csv(){const url=URL.createObjectURL(new Blob([reportCsv(records)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='asset-statement.csv';a.click();URL.revokeObjectURL(url);}
 return <section ref={ref} className="card section operation-detail-card" aria-label={t('تفاصيل الأصل والإجراءات','Asset details and actions')}><div className="page-head"><h3>{asset.name}</h3><ActionButton icon="close" label={t('إغلاق التفاصيل','Close details')} onClick={onClose}/></div>
 {asset.financial_event_status&&<p className="pill">{assetPurchaseStatus(asset.financial_event_status,ar)}</p>}
 <dl className="operation-detail-grid">{records.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{typeof value==='number'?value.toLocaleString('en-US'):value}</dd></div>)}</dl>
 {isAssetOpeningVoucher(asset)&&<AssetOpeningControls asset={asset} ar={ar} onChanged={()=>onOpeningChanged?.()}/>}
 <div className="asset-detail-actions asset-details-footer"><ActionButton icon="edit" label={t('تعديل بيانات الأصل','Edit asset data')} onClick={onEdit}/>{asset.current_quantity>0&&<ActionButton icon="operations" label={t('بيع أو إهلاك أو استبعاد','Sale, depreciation or disposal')} onClick={onLifecycle}/>}<ActionButton icon="print" label={t('طباعة PDF','Print PDF')} onClick={print}/><ActionButton icon="download" label={t('تصدير CSV','Export CSV')} onClick={csv}/>{asset.financial_review_events?.map((e:any,i:number)=><ActionButton key={e.id} icon="history" label={`${t('المراجعة والسجل المالي','Financial review and history')}${asset.financial_review_events.length>1?` (${i+1})`:''}`} onClick={()=>onReview(e.id)}/>)}</div>
 <p>{t('القيمة الحالية','Current value')}: <Money value={asset.current_market_value??0} currency={asset.current_value_currency??asset.currency} organizationId={asset.organization_id}/></p>
 </section>;
}
