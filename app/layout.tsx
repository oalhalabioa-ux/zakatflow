import './globals.css';
import './landing.css';
import './yaqeen-brand.css';
import type { Metadata } from 'next';
import {headers} from 'next/headers';
import {Suspense} from 'react';
import DocumentLanguage from '../components/DocumentLanguage';
import { PRIVATE_PAGE_ROBOTS, SITE_URL } from '../lib/site-seo';
export const metadata:Metadata={metadataBase:new URL(SITE_URL),title:{default:'يقين الأعمال | YAQEEN BUSINESS',template:'%s | YAQEEN BUSINESS'},description:'منصة الإدارة المالية والأعمال الذكية — Smart Finance & Business Platform',applicationName:'يقين الأعمال',appleWebApp:{capable:true,title:'يقين الأعمال',statusBarStyle:'default'},robots:PRIVATE_PAGE_ROBOTS};
export default async function RootLayout({children}:{children:React.ReactNode}){const locale=(await headers()).get('x-yaqeen-locale')==='en'?'en':'ar';return <html lang={locale} dir={locale==='ar'?'rtl':'ltr'}><body><Suspense fallback={null}><DocumentLanguage/></Suspense>{children}</body></html>}
