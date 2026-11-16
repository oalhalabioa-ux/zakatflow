import { describe, expect, it } from 'vitest';
import { shouldTrackVisitor } from '../lib/analytics/visitor-tracking';

describe('visitor tracking eligibility', () => {
  it('tracks only the verified production application hostname', () => {
    expect(shouldTrackVisitor('app.yaqeenbiz.com', true)).toBe(true);
    expect(shouldTrackVisitor('APP.YAQEENBIZ.COM', true)).toBe(true);
  });

  it('never tracks previews, QA, localhost, or the unverified marketing host', () => {
    for (const host of ['app.yaqeenbiz.com', 'localhost', 'zakatflow-qa.vercel.app']) {
      expect(shouldTrackVisitor(host, false)).toBe(false);
    }
    for (const host of ['yaqeenbiz.com', 'www.yaqeenbiz.com', 'localhost', 'zakatflow-preview.vercel.app', 'evilapp.yaqeenbiz.com']) {
      expect(shouldTrackVisitor(host, true)).toBe(false);
    }
  });
});
