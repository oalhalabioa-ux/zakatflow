import {expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({redirect:vi.fn()}));
vi.mock('next/navigation',()=>({redirect:mocks.redirect}));
import Page from './[locale]/qard-loans/page';
it('keeps organization, group and direction when resolving the old QARD address',async()=>{await Page({params:Promise.resolve({locale:'ar'}),searchParams:Promise.resolve({organization:'child',level:'GROUP',side:'RECEIVABLE',contract_id:'loan'})});const url=new URL(mocks.redirect.mock.calls[0][0],'https://example.test');expect(url.pathname).toBe('/ar/loans');expect(Object.fromEntries(url.searchParams)).toEqual({organization:'child',level:'GROUP',side:'RECEIVABLE',contract_id:'loan',scope:'ORGANIZATION',product:'QARD'});});
