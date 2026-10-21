import React from 'react';
import {it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
vi.stubGlobal('React',React);
import InvestmentPortfolioDashboard from './InvestmentPortfolioDashboard';

const props={instruments:[],operations:[],participations:[],asOf:'2026-10-21',baseCurrency:'SAR',loading:false,organizationId:null,onOpen:()=>{}};
it('does not present a missing contract source as a confirmed zero total',()=>{
 const html=renderToStaticMarkup(<InvestmentPortfolioDashboard {...props} contractsAvailable={false}/>);
 expect(html).toContain('قراءة عقود الاستثمار غير مكتملة');
 expect(html).toContain('الرصيد المستثمر</small><strong dir="ltr">—</strong>');
});
it('does not present missing instrument data as a confirmed zero total or no maturities',()=>{
 const html=renderToStaticMarkup(<InvestmentPortfolioDashboard {...props} contractsAvailable unavailable/>);
 expect(html).toContain('الرصيد المستثمر</small><strong dir="ltr">—</strong>');
 expect(html).toContain('تعذر عرض الاستحقاقات حتى اكتمال قراءة المصادر');
 expect(html).not.toContain('لا توجد استحقاقات لاستثمارات نشطة');
});
