import React from 'react';
import {it,expect,vi} from 'vitest';
vi.stubGlobal('React',React);
import {renderToStaticMarkup} from 'react-dom/server';
import OpeningBalanceForm from './OpeningBalanceForm';
const data={organization:{name:'Test company',base_currency:'SAR'},entities:[],parties:[{id:'party',name:'Supplier'}]},props={organizationId:'org',data,initialSide:'PAYABLE',onClose:()=>{},onSaved:()=>{}};
it('shows an opening voucher without loan, bank or required schedule generation controls',()=>{const html=renderToStaticMarkup(<OpeningBalanceForm {...props}/>);expect(html).toContain('سند رصيد افتتاحي');expect(html).toContain('تاريخ الاستحقاق');expect(html).toContain('حفظ السند للاعتماد');for(const label of ['طريقة الإثبات','نوع السجل','الحساب البنكي','عدد الاستحقاقات','الفرع'])expect(html).not.toContain('>'+label+'<');expect(html).toContain('aria-checked="false"');});
it('exposes catalog load failures and shows subsidiary choice only when present',()=>{const html=renderToStaticMarkup(<OpeningBalanceForm {...props} data={null} loadError="تعذر تحميل بيانات المنشأة."/>);expect(html).toContain('role="alert"');expect(html).toContain('تعذر تحميل بيانات المنشأة.');const subsidiary=renderToStaticMarkup(<OpeningBalanceForm {...props} data={{...data,entities:[{id:'branch',name:'Branch'}]}}/>);expect(subsidiary).toContain('>الفرع<');});
