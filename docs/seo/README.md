# Yaqeen public website SEO

The public website lives at `https://yaqeenbiz.com/`. Its English variant is
`https://yaqeenbiz.com/?lang=en`. Both pages have distinct titles, descriptions,
canonical URLs, reciprocal language alternates and an Arabic `x-default`.
The duplicated landing page on `app.yaqeenbiz.com` points to the same canonical
website rather than competing with it. Tracking parameters are not canonical.
Homepage metadata uses absolute URLs with a null metadata base because Next.js
15 otherwise removes query parameters from root-path canonical and alternate
URLs. This preserves the English `?lang=en` variant in the rendered HTML.

`app/sitemap.ts` lists only those two public pages, with language alternates.
Do not add authenticated, admin, login, preview, design-review or API URLs.
There is no synthetic `lastModified` timestamp: a deploy does not necessarily
mean that public content has changed.

Root metadata defaults to `noindex, nofollow` for application pages. The public
homepage opts into indexing only for the two production domains and `www`.
Unknown hosts and preview URLs retain `noindex`. Any future public marketing
page must explicitly opt into indexing and provide its own canonical metadata.
`robots.txt` allows HTML crawling so search engines can read these directives;
only `/api/` is disallowed. These directives are not access controls and do not
replace existing authentication or authorization.

The homepage publishes Organization and WebSite JSON-LD using verified brand
details. It does not invent a legal entity, address, pricing, ratings or reviews.
Social metadata includes localized text and a 1200×630 image composed from the
existing approved white/gold logo on the navy brand background. No tracking
scripts, analytics, authentication changes or database changes are introduced.

## Release validation

- Run `npx vitest run tests/site-seo.test.ts`, TypeScript and the production build.
- Check both public language variants for one canonical URL, reciprocal
  `hreflang`, indexable robots, valid JSON-LD and absolute OG image URLs.
- Check an unknown/preview host and the login route retain `noindex`.
- Confirm `/robots.txt`, `/sitemap.xml` and the share image return 200 on the
  primary domain, with the correct content types and no unexpected redirects.
- Confirm existing favicon, Apple icon and manifest links remain present.

## Search Console follow-up

If the domain is already verified in Google Search Console, submit
`https://yaqeenbiz.com/sitemap.xml`, then inspect the Arabic and English homepage
URLs and request indexing. Otherwise, the domain owner must first complete
Google's verification flow; no verification token is assumed or fabricated.
Search Console submission and actual indexing/ranking are separate from this
code release. Track impressions, queries, clicks, indexing and Core Web Vitals
there before planning dedicated public feature pages or additional content.
