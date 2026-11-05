import {describe,expect,it} from 'vitest';
import {FINANCIAL_INDUSTRIES,industryAccountTemplate,industryTemplatePreview} from './financial-chart-templates';

const canonical=new Set(['1000','1100','1200','1300','1400','1500','1590','1600','1700','1800','2100','2200','2300','2400','2500','3100','3200','3300','4100','5100','6100','6200','7100','8100']);

describe('standardized industry account templates',()=>{
 it('keeps every suggested account under a shared four-digit control account',()=>{
  const seen=new Map<string,string>();
  for(const industry of FINANCIAL_INDUSTRIES){
   const accounts=industryAccountTemplate(industry.id);
   expect(accounts.length).toBeGreaterThan(12);
   for(const item of accounts){
    expect(item.code).toMatch(/^\d{6}$/);
    expect(item.parentCode).toBe(item.code.slice(0,4));
    expect(canonical.has(item.parentCode)).toBe(true);
    expect(item.normalSide).toMatch(/^(DEBIT|CREDIT)$/);
    const previous=seen.get(item.code);
    if(previous)expect(previous).toBe(`${item.nameAr}:${item.nameEn}`);
    else seen.set(item.code,`${item.nameAr}:${item.nameEn}`);
   }
   expect(new Set(accounts.map(item=>item.code)).size).toBe(accounts.length);
  }
 });
 it('keeps common subaccounts identical across industries',()=>{
  const common=industryAccountTemplate('GENERAL').filter(item=>item.source==='CORE');
  for(const industry of FINANCIAL_INDUSTRIES){
   expect(industryAccountTemplate(industry.id).filter(item=>item.source==='CORE')).toEqual(common);
  }
 });
 it('previews exact existing matches and refuses to overwrite occupied numbers',()=>{
  const [template]=industryAccountTemplate('GENERAL');
  const preview=industryTemplatePreview('GENERAL',[{code:template.code,ar:'حساب مختلف',en:template.nameEn,normalSide:template.normalSide,isActive:true,isPostable:true}]);
  expect(preview.find(row=>row.code===template.code)?.status).toBe('occupied');
  const matching=industryTemplatePreview('GENERAL',[{code:template.code,ar:template.nameAr,en:template.nameEn,normalSide:template.normalSide,isActive:true,isPostable:true}]);
  expect(matching.find(row=>row.code===template.code)?.status).toBe('matching');
  expect(matching.some(row=>row.status==='available')).toBe(true);
 });
});
