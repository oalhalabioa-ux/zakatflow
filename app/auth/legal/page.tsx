import Link from 'next/link';
import YaqeenBrand from '@/components/YaqeenBrand';
import {legalCopy} from '@/lib/auth/legal-copy';
import '../../yaqeen-auth.css';
export const metadata={robots:{index:false,follow:false}};
export default async function LegalDraft({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const q=await searchParams,locale=q.lang==='en'?'en':'ar',c=legalCopy[locale],privacy=q.kind==='privacy';
 return <main className="yqa yqa-legal" dir={locale==='ar'?'rtl':'ltr'}><article className="yqa-card"><YaqeenBrand/><h1>{privacy?c.privacyTitle:c.termsTitle}</h1><p className="yqa-notice">{c.draft}</p><p>{c.intro}</p>{(privacy?c.privacy:c.terms).map(([title,body])=><section key={title}><h2>{title}</h2><p>{body}</p></section>)}<Link href={`/${locale}/login?tab=signup`}>{c.back}</Link></article></main>
}
