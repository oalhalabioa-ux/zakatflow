import React from 'react';
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
vi.stubGlobal('React',React);
import DebtPartyPicker from './DebtPartyPicker';
const parties=[{id:'employee',name:'أحمد الموظف',party_type:'OTHER',party_type_id:'employee-type'},{id:'supplier',name:'مورد سابق',party_type:'SUPPLIER'}];
const partyTypes=[{id:'employee-type',code:'EMPLOYEE',name_ar:'موظف'}];
it('defaults employee advances to employee classification and retains the all-parties escape hatch',()=>{const html=renderToStaticMarkup(<DebtPartyPicker organizationId="org" parties={parties} partyTypes={partyTypes} employee value="" onChange={()=>{}}/>);expect(html).toContain('value="EMPLOYEE" selected');expect(html).toContain('أحمد الموظف');expect(html).not.toContain('مورد سابق');expect(html).toContain('جميع الجهات')});
it('keeps an already selected legacy party visible and leaves generic vouchers unfiltered',()=>{const selected=renderToStaticMarkup(<DebtPartyPicker organizationId="org" parties={parties} partyTypes={partyTypes} employee value="supplier" onChange={()=>{}}/>);expect(selected).toContain('مورد سابق');const generic=renderToStaticMarkup(<DebtPartyPicker organizationId="org" parties={parties} partyTypes={partyTypes} value="" onChange={()=>{}}/>);expect(generic).toContain('أحمد الموظف');expect(generic).toContain('مورد سابق')});
