import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const layout = readFileSync(join(root, 'app/layout.tsx'), 'utf8');
const component = readFileSync(join(root, 'components/VisitorAnalytics.tsx'), 'utf8');

describe('visitor analytics root integration', () => {
  it('mounts exactly one analytics loader from the root layout', () => {
    expect(layout).toContain("import VisitorAnalytics from '../components/VisitorAnalytics'");
    expect(layout.match(/<VisitorAnalytics\s*\/>/g)).toHaveLength(1);
  });

  it('loads the Vercel first-party script only behind the tested production hostname gate', () => {
    expect(component).toContain('shouldTrackVisitor(window.location.hostname, process.env.NODE_ENV === \'production\')');
    expect(component).toContain("script.src = '/_vercel/insights/script.js'");
    expect(component).toContain("document.querySelector('script[data-yaqeen-analytics]')");
    expect(component).not.toMatch(/google-analytics|gtag\(|GTM-/);
  });
});
