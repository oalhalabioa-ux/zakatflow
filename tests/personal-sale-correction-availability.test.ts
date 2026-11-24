import {afterEach, describe, expect, it, vi} from 'vitest';
import {isPersonalSaleCorrectionCandidate} from '../lib/personal-sale-correction';

const owner = 'owner';
const sale = {
  transaction_type: 'SALE',
  user_id: owner,
  transfer_id: 'transfer',
  metadata: {proceeds_account_id: 'bank'},
};
const groupedSale = {
  ...sale,
  metadata: {...sale.metadata, lot_sale_request: 'grouped-request'},
};

afterEach(() => vi.unstubAllEnvs());

describe('personal sale correction availability', () => {
  it.each([undefined, '0'])('keeps legacy correction available when grouped sales are off (%s)', flag => {
    vi.stubEnv('NEXT_PUBLIC_PERSONAL_GOLD_SALES', flag);

    expect(isPersonalSaleCorrectionCandidate(sale, owner)).toBe(true);
    expect(isPersonalSaleCorrectionCandidate(groupedSale, owner)).toBe(false);
  });

  it('offers grouped correction only to the owner of an eligible personal voucher', () => {
    vi.stubEnv('NEXT_PUBLIC_PERSONAL_GOLD_SALES', '1');

    expect(isPersonalSaleCorrectionCandidate(groupedSale, owner)).toBe(true);
    expect(isPersonalSaleCorrectionCandidate(groupedSale, 'outsider')).toBe(false);
    expect(isPersonalSaleCorrectionCandidate({...groupedSale, organization_id: 'company'}, owner)).toBe(false);
    expect(isPersonalSaleCorrectionCandidate({
      ...groupedSale,
      asset_accounts: {ownership_scope: 'ORGANIZATION'},
    }, owner)).toBe(false);
  });
});
