import Link from 'next/link';

export default function SetupReturnLink({locale,organization,visible}:{locale:string;organization?:string;visible:boolean}){
  if(!visible||!organization)return null;
  return <div style={{maxWidth:1250,margin:'12px auto',padding:'0 15px'}} dir={locale==='ar'?'rtl':'ltr'}>
    <Link href={`/${locale}/settings/financial/setup?organization=${encodeURIComponent(organization)}`} style={{display:'inline-flex',alignItems:'center',minHeight:40,border:'1px solid #c6a35d',borderRadius:9,padding:'7px 14px',fontWeight:700,color:'var(--brand-text,#10243a)',textDecoration:'none',background:'var(--brand-surface,#fff)'}}>
      {locale==='ar'?'العودة إلى رحلة إعداد المؤسسة':'Return to organization setup'}
    </Link>
  </div>;
}
