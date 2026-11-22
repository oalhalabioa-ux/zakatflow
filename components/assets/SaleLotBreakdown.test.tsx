import React from 'react';
import {vi} from 'vitest';
vi.stubGlobal('React',React);
import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import SaleLotBreakdown,{postedSaleSummary} from './SaleLotBreakdown';

const record={
  id:'sale',reference:'QA-481',base_currency:'SAR',base_value:'2400',
  metadata:{lot_sale_request:'request',lot_selection:{
    method:'MANUAL',cost_base:2000,realized_gain_base:400,
    allocations:[{lot_id:'00000000-0000-4000-8000-000000000005',allocated_quantity:1,cost_base:300,quantity_after:3,cost_after:900},
      {lot_id:'00000000-0000-4000-8000-000000000006',allocated_quantity:5,cost_base:1700,quantity_after:1,cost_after:340}],
  }},
};
describe('Posted voucher summary',()=>{
  it.each([true,false])('renders the recorded amounts with collapsed lot details (Arabic=%s)',ar=>{
    const sale=postedSaleSummary(record,ar);
    expect(sale?.realizedGain).toBe(400);
    const html=renderToStaticMarkup(createElement(SaleLotBreakdown,{sale:sale!,ar}));
    expect(html).toContain('QA-481');
    expect(html).toContain(ar?'الربح المحقق':'Realized gain');
    expect(html).toContain('<details>');
    expect(html).not.toContain('<details open');
    expect(html).toContain(record.metadata.lot_selection.allocations[1].lot_id);
  });
  it('omits unsupported and historical records without allocations',()=>{
    expect(postedSaleSummary({...record,metadata:{}},true)).toBeNull();
    expect(postedSaleSummary({...record,base_value:'invalid'},true)).toBeNull();
  });
});
