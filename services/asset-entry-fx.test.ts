import { describe, expect, it, vi } from 'vitest';
import { resolveAssetEntryFx } from './asset-entry-fx';

const user = 'owner-id';
const organization = 'company-id';
const date = '2026-11-07';
const saved = {
  id: 'personal', from_currency: 'SAR', to_currency: 'USD', rate: 0.25,
  valuation_date: date, source: 'Personal',
};
const global = {
  ...saved, id: 'global', from_currency: 'USD', to_currency: 'SAR', rate: 3.75, source: 'Reference',
};

function setup(personal = [saved]) {
  const ownerQuotes = builder(personal);
  const orgQuotes = builder([{ ...global, id: 'org-rate', rate: 3.9 }]);
  const globalQuotes = builder([global]);
  const from = vi.fn((table: string) => {
    if (table === 'profiles' || table === 'organizations') {
      return builder({ base_currency: 'SAR' });
    }
    if (table === 'organization_members') return builder({ status: 'ACTIVE' });
    if (table === 'currencies') return builder([{ code: 'USD' }, { code: 'SAR' }]);
    if (table === 'personal_fx_rates') return ownerQuotes;
    if (table === 'fx_rates') return { select: () => ({ eq: orgQuotes.eq, is: globalQuotes.is }) };
    throw Error('Unexpected table ' + table);
  });
  return { supabase: { from }, ownerQuotes, orgQuotes, globalQuotes };
}

function builder(data: unknown) {
  const q = {
    then: (callback: (result: unknown) => unknown) => Promise.resolve({ data }).then(callback),
    select: vi.fn(), eq: vi.fn(), is: vi.fn(), in: vi.fn(), or: vi.fn(), lte: vi.fn(),
    gt: vi.fn(), order: vi.fn(), single: vi.fn(), maybeSingle: vi.fn(), limit: vi.fn(),
  };
  for (const method of Object.values(q).slice(1)) (method as ReturnType<typeof vi.fn>).mockReturnValue(q);
  return q;
}

describe('historical FX in asset entry', () => {
  it('prefers the account owner’s dated rate and converts inverse pairs', async () => {
    const { supabase, ownerQuotes, orgQuotes, globalQuotes } = setup();
    expect(await resolveAssetEntryFx(supabase, user, 'USD', date, null))
      .toMatchObject({ rate: 4, base_currency: 'SAR', row: { id: 'personal' } });
    expect(ownerQuotes.eq).toHaveBeenCalledWith('user_id', user);
    expect(ownerQuotes.lte).toHaveBeenCalledWith('valuation_date', date);
    expect(orgQuotes.eq).not.toHaveBeenCalled();
    expect(globalQuotes.is).not.toHaveBeenCalled();
  });

  it('falls back to global rates when the personal account has no eligible quote', async () => {
    const { supabase, globalQuotes } = setup([{ ...saved, valuation_date: '2026-11-08' }]);
    expect(await resolveAssetEntryFx(supabase, user, 'USD', date, null))
      .toMatchObject({ rate: 3.75, row: { id: 'global' } });
    expect(globalQuotes.is).toHaveBeenCalledWith('organization_id', null);
  });

  it('uses the selected company’s rates without consulting personal rows', async () => {
    const { supabase, orgQuotes, ownerQuotes } = setup();
    expect(await resolveAssetEntryFx(supabase, user, 'USD', date, organization))
      .toMatchObject({ rate: 3.9, row: { id: 'org-rate', organization_id: organization } });
    expect(orgQuotes.eq).toHaveBeenCalledWith('organization_id', organization);
    expect(ownerQuotes.select).not.toHaveBeenCalled();
  });
});
