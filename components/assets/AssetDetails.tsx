'use client';
import {assetPurchaseStatus} from '@/lib/asset-purchase-workspace';
import AssetOpeningControls from './AssetOpeningControls';
import {isAssetOpeningVoucher} from '@/lib/asset-opening-workspace';
export default function AssetDetails({asset,ar,onOpeningChanged}:{asset:any;ar:boolean;onOpeningChanged:()=>void}){
 const t=(a:string,e:string)=>ar?a:e;
 const records:Array<[string,string]>=[[t('تاريخ الاقتناء','Acquisition date'),asset.metadata?.purchase_date??'—'],[t('العملة الأساسية','Base currency'),asset.current_value_currency??asset.currency]];
 return <section className="asset-card-info" aria-label={t('بيانات الأصل','Asset information')}>
 {asset.financial_event_status&&<p className="pill">{assetPurchaseStatus(asset.financial_event_status,ar)}</p>}
 <dl className="operation-detail-grid">{records.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
 {asset.metadata?.notes&&<div className="asset-card-notes"><h3>{t('ملاحظات الأصل','Asset notes')}</h3><p>{asset.metadata.notes}</p></div>}
 {isAssetOpeningVoucher(asset)&&<AssetOpeningControls asset={asset} ar={ar} onChanged={onOpeningChanged}/>}
 </section>;
}
