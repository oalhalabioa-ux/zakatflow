'use client';
import ActionButton from '../ActionButton';
import {assetPurchaseStatus} from '@/lib/asset-purchase-workspace';
import AssetOpeningControls from './AssetOpeningControls';
import {isAssetOpeningVoucher} from '@/lib/asset-opening-workspace';
export default function AssetDetails({asset,ar,onClose,editActions,onLifecycle,onReview,onOpeningChanged}:{asset:any;ar:boolean;onClose:()=>void;editActions:React.ReactNode;onLifecycle?:()=>void;onReview:(id:string)=>void;onOpeningChanged?:()=>void}){
 const t=(a:string,e:string)=>ar?a:e;
 const records:Array<[string,string|number]>=[[t('الأصل','Asset'),asset.name],[t('تاريخ الاقتناء','Acquisition date'),asset.metadata?.purchase_date??'—'],[t('الكمية الحالية','Current quantity'),Number(asset.current_quantity??0)],[t('التكلفة الدفترية','Book cost'),Number(asset.current_cost_value??0)],[t('العملة الأساسية','Base currency'),asset.current_value_currency??asset.currency],[t('تصنيف الأصل','Asset class'),asset.asset_class_code??asset.asset_type],[t('حالة الأصل','Asset status'),asset.lifecycle_status??'ACTIVE']];
 return <section className="card section operation-detail-card" aria-label={t('تفاصيل الأصل والإجراءات','Asset details and actions')}><div className="page-head"><h3>{asset.name}</h3><ActionButton icon="close" label={t('إغلاق التفاصيل','Close details')} onClick={onClose}/></div>
 {asset.financial_event_status&&<p className="pill">{assetPurchaseStatus(asset.financial_event_status,ar)}</p>}
 <dl className="operation-detail-grid">{records.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{typeof value==='number'?value.toLocaleString('en-US'):value}</dd></div>)}</dl>
 {editActions}
 {isAssetOpeningVoucher(asset)&&<AssetOpeningControls asset={asset} ar={ar} onChanged={()=>onOpeningChanged?.()}/>}
 <div className="asset-detail-actions asset-details-footer">{asset.current_quantity>0&&onLifecycle&&<ActionButton icon="operations" label={t('بيع أو إهلاك أو استبعاد','Sale, depreciation or disposal')} onClick={onLifecycle}/>}{asset.financial_review_events?.map((e:any,i:number)=><ActionButton key={e.id} icon="history" label={`${t('المراجعة والسجل المالي','Financial review and history')}${asset.financial_review_events.length>1?` (${i+1})`:''}`} onClick={()=>onReview(e.id)}/>)}</div>
 </section>;
}
