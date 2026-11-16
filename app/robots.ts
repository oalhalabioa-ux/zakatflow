import type { MetadataRoute } from 'next';
import { SITE_URL } from '../lib/site-seo';

export default function robots(): MetadataRoute.Robots {
  return {
    // Keep HTML crawlable so crawlers can read the noindex metadata on account pages.
    // Authentication and authorization continue to protect private data.
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
