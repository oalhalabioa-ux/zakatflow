import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
const source = readFileSync('scripts/zatca/simulation-qa-ui.js', 'utf8');
const company = { legalName: 'Synthetic Company', vatNumber: '312345678901233', branchName: 'Riyadh', branchLocation: 'AAAA1234', industry: 'Software', unitName: 'Synthetic QA', email: 'qa@example.invalid' };
const ready = { state: 'READY_FOR_OTP', sourceSha: 'a'.repeat(40), company, csrSha256: 'b'.repeat(64) };
class Element {
  value = ''; textContent = ''; disabled = false; hidden = false; dataset: Record<string,string> = {};
  listeners: Record<string, (...args: any[]) => void> = {};
  addEventListener(name: string, callback: (...args: any[]) => void) { this.listeners[name] = callback; }
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
async function fixture(initial = ready) {
  const elements = new Map<string,Element>(), windowEvents: Record<string,() => void> = {};
  const get = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  const fetcher = vi.fn(async (_url: string, _request?: RequestInit) => ({ ok: true, json: async () => structuredClone(initial) }));
  runInNewContext(source, { document: { getElementById: get }, window: { addEventListener: (name: string, handler: () => void) => { windowEvents[name] = handler; } }, fetch: fetcher, Error });
  await settle();
  return { get, fetcher, windowEvents };
}
describe('Simulation QA user input and recovery behavior', () => {
  it('loads status once without generating a CSR or submitting an OTP', async () => {
    const f = await fixture();
    expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.fetcher.mock.calls[0][1]?.method).toBeUndefined();
    expect(f.get('otpSection').hidden).toBe(false); expect(f.get('submit').disabled).toBe(false);
    expect(f.get('legalName').textContent).toBe(company.legalName);
    expect(f.get('vatNumber').textContent).toBe(company.vatNumber);
  });
  it('requires explicit preparation and never shows the OTP form before readiness', async () => {
    const f = await fixture({ ...ready, state: 'NOT_PREPARED' });
    expect(f.get('otpSection').hidden).toBe(true); expect(f.get('prepare').disabled).toBe(false);
    f.get('prepare').listeners.click(); await settle();
    expect(JSON.parse(String(f.fetcher.mock.calls[1][1]?.body))).toEqual({ action: 'prepare' });
  });
  it('clears the OTP immediately, suppresses double clicks, and hides the form after quarantine', async () => {
    const f = await fixture(); let complete!: (value: any) => void;
    f.fetcher.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    f.get('otp').value = '654321';
    const event = { preventDefault: vi.fn() };
    f.get('otpForm').listeners.submit(event);
    expect(f.get('otp').value).toBe(''); expect(f.get('submit').disabled).toBe(true);
    f.get('otpForm').listeners.submit(event);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(f.fetcher.mock.calls[1][1]?.body))).toEqual({ action: 'submit', otp: '654321', csrSha256: ready.csrSha256 });
    complete({ ok: true, json: async () => ({ ...ready, state: 'RESPONSE_QUARANTINED', identityMatched: true }) }); await settle();
    expect(f.get('otpSection').hidden).toBe(true); expect(f.get('submit').disabled).toBe(true);
  });
  it('does not resubmit after an unknown response; refresh is GET only', async () => {
    const f = await fixture(); f.fetcher.mockRejectedValueOnce(new Error('Network unavailable'));
    f.get('otp').value = '654321'; f.get('otpForm').listeners.submit({ preventDefault() {} }); await settle();
    expect(f.get('otp').value).toBe(''); expect(f.get('otpSection').hidden).toBe(true);
    f.get('otpForm').listeners.submit({ preventDefault() {} }); expect(f.fetcher).toHaveBeenCalledTimes(2);
    f.fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ ...ready, state: 'RECONCILIATION_REQUIRED' }) });
    f.get('refresh').listeners.click(); await settle();
    expect(f.fetcher.mock.calls[2][1]?.method).toBeUndefined(); expect(f.get('otpSection').hidden).toBe(true);
  });
  it('hides stale readiness when a status refresh fails', async () => {
    const f = await fixture(); f.fetcher.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'QA_SIGNING_KEY_UNAVAILABLE' }) } as never);
    f.get('refresh').listeners.click(); await settle();
    expect(f.get('otpSection').hidden).toBe(true); expect(f.get('submit').disabled).toBe(true);
  });
  it('uses text rendering, clears input on leaving, and never uses browser persistence/logging', async () => {
    const f = await fixture({ ...ready, company: { ...company, legalName: '<img src=x onerror=alert(1)>' } });
    expect(f.get('legalName').textContent).toBe('<img src=x onerror=alert(1)>');
    f.get('otp').value = '654321'; f.windowEvents.pagehide(); expect(f.get('otp').value).toBe('');
    expect(source).not.toMatch(/innerHTML|localStorage|sessionStorage|document\.cookie|sendBeacon|console\./);
  });
});
