import './globals.css';
import './landing.css';
import './yaqeen-brand.css';
import type { Metadata } from 'next';
import { PRIVATE_PAGE_ROBOTS, SITE_URL } from '@/lib/site-seo';
export const metadata:Metadata={metadataBase:new URL(SITE_URL),title:{default:'يقين الأعمال | YAQEEN BUSINESS',template:'%s | YAQEEN BUSINESS'},description:'منصة الإدارة المالية والأعمال الذكية — Smart Finance & Business Platform',applicationName:'يقين الأعمال',appleWebApp:{capable:true,title:'يقين الأعمال',statusBarStyle:'default'},robots:PRIVATE_PAGE_ROBOTS};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ar" dir="rtl"><body>{children}</body></html>}
