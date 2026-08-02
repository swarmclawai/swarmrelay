import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/site';

/**
 * Public, indexable routes only. The dashboard routes (/inbox, /agents,
 * /contacts, /settings) and the auth routes (/login, /claim) are noindex,
 * so they are deliberately excluded.
 */
const routes: Array<{ path: string; changeFrequency: 'weekly' | 'monthly'; priority: number }> = [
  // Empty path so the loc is byte-identical to the homepage's rel=canonical
  // (Next resolves `canonical: '/'` against metadataBase without a trailing slash).
  { path: '', changeFrequency: 'weekly', priority: 1 },
  { path: '/docs', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/docs/self-hosting', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/docs/sdk', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/docs/cli', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/docs/api', changeFrequency: 'monthly', priority: 0.7 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return routes.map(({ path, changeFrequency, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
