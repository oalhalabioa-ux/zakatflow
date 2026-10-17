import React from 'react';
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
vi.stubGlobal('React',React);
import Home from '../app/page';
it('renders both languages, all sections and an explicit synthetic dashboard with existing login routes',async()=>{for(const lang of ['ar','en']){const html=renderToStaticMarkup(await Home({searchParams:Promise.resolve({lang})}));for(const id of ['features','solutions','modules','sectors','dashboard'])expect(html).toContain('id="'+id+'"');expect(html).toContain('/'+lang+'/login');expect(html).toContain('YAQEEN BUSINESS');expect(html).toContain(lang==='ar'?'الأرقام أمثلة وليست بيانات عملاء':'figures are examples, never customer data');expect(html).not.toContain('info@');expect(html).not.toContain('+50,000')}});
