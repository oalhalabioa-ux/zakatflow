import Link from 'next/link';
/** Single configuration owner: organization financial settings. */
export default function FiscalPeriodControl({organization,en}:{organization:string;en:boolean}){
 if(!organization)return null;
 return <div className="fs-card fiscal-settings-link"><Link href={`/${en?'en':'ar'}/settings/financial/fiscal-years?organization=${encodeURIComponent(organization)}`}>{en?'Manage fiscal years in organization settings':'إدارة السنوات المالية من إعدادات المؤسسة'}</Link></div>;
}
