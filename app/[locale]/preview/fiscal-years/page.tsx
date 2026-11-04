import {notFound} from 'next/navigation';
import SettingsFrame from '@/components/settings/SettingsFrame';
import FiscalYearReview from '@/components/settings/FiscalYearReview';
export const dynamic='force-dynamic';
export default async function FiscalYearPreview({params}:{params:Promise<{locale:string}>}){if(process.env.VERCEL_ENV!=='preview'||process.env.FISCAL_YEAR_REVIEW_PREVIEW!=='true')notFound();const {locale}=await params;return <SettingsFrame locale={locale}><section className="settings-card"><FiscalYearReview locale={locale}/></section></SettingsFrame>}
