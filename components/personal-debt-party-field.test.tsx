import React from 'react';import {it,expect,vi} from 'vitest';import {renderToStaticMarkup} from 'react-dom/server';
vi.stubGlobal('React',React);
import PersonalDebtPartyField from './PersonalDebtPartyField';
it('offers existing parties and explicit addition without corporate organization controls',()=>{const html=renderToStaticMarkup(<PersonalDebtPartyField data={{debts:[{id:'one',partyKey:'one',partyName:'جهة قائمة',side:'RECEIVABLE',currency:'SAR'}]} as any} side="RECEIVABLE" name="" onChange={()=>{}}/>);expect(html).toContain('جهة قائمة');expect(html).toContain('إضافة جهة');expect(html).not.toContain('الشركة')});
