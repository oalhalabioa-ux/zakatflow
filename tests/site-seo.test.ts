import { describe, expect, it } from 'vitest';
import { homeMetadata, LANGUAGE_URLS, PRIVATE_PAGE_ROBOTS, publicSitemap, siteStructuredData } from '../lib/site-seo';
import robots from '../app/robots';
import { resolveAlternates } from 'next/dist/lib/metadata/resolvers/resolve-basics';

describe('public website search discovery', () => {
  it('keeps the English and Arabic versions distinct while consolidating duplicate hosts and tracking URLs', () => {
    for (const host of ['yaqeenbiz.com', 'www.yaqeenbiz.com', 'app.yaqeenbiz.com']) {
      expect(homeMetadata(false, host).alternates?.canonical).toBe(LANGUAGE_URLS.ar);
      expect(homeMetadata(true, host).alternates?.canonical).toBe(LANGUAGE_URLS.en);
      expect(homeMetadata(false, host).robots).toMatchObject({ index: true, follow: true });
    }
    expect(homeMetadata(true, 'yaqeenbiz.com').alternates?.languages).toMatchObject({ ar: LANGUAGE_URLS.ar, en: LANGUAGE_URLS.en, 'x-default': LANGUAGE_URLS.ar });
  });

  it('keeps previews, unknown hosts and account pages out of search', () => {
    for (const host of ['localhost:3000', 'zakatflow-preview.vercel.app', 'yaqeenbiz.com.attacker.example', '']) {
      expect(homeMetadata(false, host).robots).toEqual(PRIVATE_PAGE_ROBOTS);
    }
    expect(PRIVATE_PAGE_ROBOTS.index).toBe(false);
  });

  it('preserves the English query URL through the installed Next.js metadata resolver', async () => {
    const metadata = homeMetadata(true, 'yaqeenbiz.com');
    const resolved = await resolveAlternates(metadata.alternates, metadata.metadataBase ?? null, Promise.resolve('/'), { trailingSlash: false, isStaticMetadataRouteFile: false });
    expect(resolved?.canonical?.url).toBe(LANGUAGE_URLS.en);
    expect(resolved?.languages?.en?.[0].url).toBe(LANGUAGE_URLS.en);
    expect(resolved?.languages?.ar?.[0].url).toBe(LANGUAGE_URLS.ar);
  });

  it('publishes only the two public canonical pages in the sitemap', () => {
    const sitemap = publicSitemap();
    expect(sitemap.map(page => page.url)).toEqual(Object.values(LANGUAGE_URLS));
    expect(sitemap.every(page => page.alternates?.languages?.ar === LANGUAGE_URLS.ar && page.alternates.languages.en === LANGUAGE_URLS.en)).toBe(true);
    expect(robots().rules).toMatchObject({ allow: '/', disallow: '/api/' });
    expect(robots().sitemap).toBe('https://yaqeenbiz.com/sitemap.xml');
  });

  it('provides localized social metadata and only verifiable brand identity', () => {
    const ar = homeMetadata(false, 'yaqeenbiz.com');
    const en = homeMetadata(true, 'yaqeenbiz.com');
    expect(ar.description).not.toEqual(en.description);
    expect(ar.openGraph).toMatchObject({ url: LANGUAGE_URLS.ar, locale: 'ar_SA' });
    expect(en.openGraph).toMatchObject({ url: LANGUAGE_URLS.en, locale: 'en_US' });
    expect(ar.twitter).toMatchObject({ card: 'summary_large_image' });
    expect(siteStructuredData['@graph'].map(item => item['@type'])).toEqual(['Organization', 'WebSite']);
    expect(JSON.stringify(siteStructuredData)).not.toMatch(/aggregateRating|price|review|address/);
  });
});
