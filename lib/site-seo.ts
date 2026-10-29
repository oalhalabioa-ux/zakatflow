import type { Metadata, MetadataRoute } from 'next';

export const SITE_URL = 'https://yaqeenbiz.com';
export const LANGUAGE_URLS = { ar: `${SITE_URL}/`, en: `${SITE_URL}/?lang=en` };
export const PRIVATE_PAGE_ROBOTS = { index: false, follow: false };
const languages = { ...LANGUAGE_URLS, 'x-default': LANGUAGE_URLS.ar };
const publicHosts = new Set(['yaqeenbiz.com', 'www.yaqeenbiz.com', 'app.yaqeenbiz.com']);

const copy = {
  ar: {
    title: 'يقين الأعمال | منصة الإدارة المالية والموازنات والزكاة',
    description: 'أدر السيولة والتدفقات النقدية والموازنات والأصول والاستثمارات والزكاة والفواتير والتقارير المالية، مع دعم العربية والإنجليزية والشركات والفروع في يقين الأعمال.',
    imageAlt: 'يقين الأعمال — منصة الإدارة المالية والأعمال الذكية',
  },
  en: {
    title: 'Yaqeen Business | Finance, Budgeting & Zakat Platform',
    description: 'Manage cash flow, budgets, assets, investments, zakat, invoices and financial reports with Yaqeen Business. Arabic and English support for companies and branches.',
    imageAlt: 'Yaqeen Business — Smart Finance & Business Platform',
  },
};

export function homeMetadata(en: boolean, host: string): Metadata {
  const locale = en ? 'en' : 'ar';
  const content = copy[locale];
  const index = publicHosts.has(host.toLowerCase().split(':')[0]);
  return {
    // Next 15 drops the query on root URLs when resolving against metadataBase.
    // Every public URL below is absolute; a null base preserves the English ?lang=en URL.
    metadataBase: null,
    title: { absolute: content.title },
    description: content.description,
    alternates: { canonical: LANGUAGE_URLS[locale], languages },
    robots: index
      ? { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large' } }
      : PRIVATE_PAGE_ROBOTS,
    openGraph: {
      title: content.title,
      description: content.description,
      siteName: 'يقين الأعمال | Yaqeen Business',
      type: 'website',
      url: LANGUAGE_URLS[locale],
      locale: en ? 'en_US' : 'ar_SA',
      alternateLocale: en ? ['ar_SA'] : ['en_US'],
      images: [{ url: `${SITE_URL}/brand/yaqeen-social-preview.png`, width: 1200, height: 630, alt: content.imageAlt }],
    },
    twitter: {
      card: 'summary_large_image',
      title: content.title,
      description: content.description,
      images: [{ url: `${SITE_URL}/brand/yaqeen-social-preview.png`, alt: content.imageAlt }],
    },
  };
}

export function publicSitemap(): MetadataRoute.Sitemap {
  // Only public, canonical landing pages belong here. Account URLs are intentionally excluded.
  return Object.values(LANGUAGE_URLS).map(url => ({ url, alternates: { languages } }));
}

export const siteStructuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'يقين الأعمال',
      alternateName: 'Yaqeen Business',
      url: `${SITE_URL}/`,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/icons/icon-512.png`, width: 512, height: 512 },
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: 'يقين الأعمال',
      alternateName: ['Yaqeen Business', 'YAQEEN BUSINESS'],
      url: `${SITE_URL}/`,
      inLanguage: ['ar', 'en'],
      publisher: { '@id': `${SITE_URL}/#organization` },
    },
  ],
};
