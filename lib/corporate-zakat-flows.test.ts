import {describe,it,expect} from 'vitest';
import {corporateZakatFlows} from './corporate-zakat-flows';
import {currentWorkspaceScope,navigationHref} from './topbar-navigation';
describe('corporate Zakat payments',()=>{
 const category={id:'z',organization_id:'company',accounting_group:'ZAKAT'};
 const flow={id:'f',organization_id:'company',category_id:'z',direction:'OUTFLOW'};
 it('retains corporate scope when opening payments',()=>{expect(currentWorkspaceScope('payments','', 'ORGANIZATION')).toBe('ORGANIZATION');expect(navigationHref('ar','payments','ORGANIZATION')).toContain('scope=ORGANIZATION')});
 it('keeps explicit personal selection',()=>expect(currentWorkspaceScope('payments','?scope=PERSONAL','ORGANIZATION')).toBe('PERSONAL'));
 it('includes a classified company operation',()=>expect(corporateZakatFlows([flow],[category],['company'])).toEqual([flow]));
 it('rejects other companies, transfers and inflows',()=>expect(corporateZakatFlows([{...flow,organization_id:'other'},{...flow,transfer_id:'t'},{...flow,intercompany_transfer_id:'t'},{...flow,direction:'INFLOW'}],[category],['company'])).toEqual([]));
 it('rejects tax and mismatched company categories',()=>{expect(corporateZakatFlows([flow],[{...category,accounting_group:'TAX'}],['company'])).toEqual([]);expect(corporateZakatFlows([flow],[{...category,organization_id:'other'}],['company'])).toEqual([])});
});
