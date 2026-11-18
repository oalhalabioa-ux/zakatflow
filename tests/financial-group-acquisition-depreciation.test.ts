import {expect,it} from 'vitest';
import {acquisitionDeferredTaxReversals,acquisitionUpliftDepreciation} from '../lib/financial-group-acquisition-depreciation';

const asset={accountId:'150001',kind:'ASSET',adjustment:'200.0000'} as const;
const liability={accountId:'2100',kind:'LIABILITY',adjustment:'100.0000'} as const;
const schedule={accountId:asset.accountId,usefulLifeDays:60};

it('charges only the uplift for elapsed days and caps the charge at the original uplift',()=>{
 const at=(to:string)=>acquisitionUpliftDepreciation([asset,liability],[schedule],'2026-01-01',to)?.[0];
 expect(at('2026-01-01')).toMatchObject({charge:'0.0000',remainingUplift:'200.0000'});
 expect(at('2026-01-31')).toMatchObject({charge:'100.0000',remainingUplift:'100.0000'});
 expect(at('2026-04-01')).toMatchObject({charge:'200.0000',remainingUplift:'0.0000'});
});
it('rejects partial, duplicated and negative uplift schedules',()=>{
 const at=(assets:Parameters<typeof acquisitionUpliftDepreciation>[0],schedules:Parameters<typeof acquisitionUpliftDepreciation>[1])=>
  acquisitionUpliftDepreciation(assets,schedules,'2026-01-01','2026-01-31');
 expect(at([asset],[])).toBeNull();
 expect(at([asset],[schedule,schedule])).toBeNull();
 expect(at([{...asset,adjustment:'-20'}],[schedule])).toBeNull();
});

it('reverses the approved opening tax liability on the same schedule and refuses invalid mapping',()=>{
 const book=[{...asset,bookValue:'0'},{...liability,bookValue:'0',adjustment:'40'}];
 const linked={...schedule,deferredTaxLiabilityAccountId:liability.accountId};
 const at=(to:string)=>acquisitionDeferredTaxReversals(book,[linked],'2026-01-01',to,true)?.[0];
 expect(at('2026-01-31')).toMatchObject({openingLiability:'40.0000',reversal:'20.0000',remainingLiability:'20.0000'});
 expect(at('2026-04-01')).toMatchObject({reversal:'40.0000',remainingLiability:'0.0000'});
 expect(acquisitionDeferredTaxReversals(book,[schedule],'2026-01-01','2026-01-31',true)).toBeNull();
 expect(acquisitionDeferredTaxReversals(book,[linked,linked],'2026-01-01','2026-01-31',true)).toBeNull();
 expect(acquisitionDeferredTaxReversals([{...book[0]},{...book[1],bookValue:'5'}],[linked],'2026-01-01','2026-01-31',true)).toBeNull();
});
