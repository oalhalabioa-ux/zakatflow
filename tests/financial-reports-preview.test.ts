import {describe,it,expect} from 'vitest';
import {previewSeries,previewSummary,previewCsv,type PreviewOrganization} from '../lib/financial-reports-preview';
describe('isolated synthetic reporting preview',()=>{
 it('reconciles revenue less expenses to profit in every month',()=>{for(const org of ['demo-holding','demo-services'] as const)for(const row of previewSeries(org,12))expect(row.profit).toBeCloseTo(row.revenue-row.expense,10)});
 it('keeps each demo organization independent and validates unknown scopes',()=>{expect(previewSummary('demo-services',12).revenue).toBeCloseTo(120.5*.35);expect(previewSummary('demo-holding',12).revenue).toBe(120.5);expect(()=>previewSeries('untrusted' as PreviewOrganization,12)).toThrow('UNKNOWN_PREVIEW_ORGANIZATION')});
 it('changes period rows consistently for the chart and exports',()=>{for(const count of [3,6,12]){const rows=previewSeries('demo-holding',count);expect(rows).toHaveLength(count);const csv=previewCsv('demo-holding',count);expect(csv.split('\r\n')).toHaveLength(count+3);expect(csv).toContain('2024-12');expect(csv).toContain(rows[0].revenue.toFixed(2))}expect(()=>previewSeries('demo-holding',0)).toThrow()});
 it('calculates ratios and budget variance without adding monthly percentages',()=>{const s=previewSummary('demo-holding',12);expect(s.profit).toBeCloseTo(33.2);expect(s.margin).toBeCloseTo(33.2/120.5*100);expect(s.variance).toBeCloseTo(4.7);expect(s.achievement).toBeCloseTo(120.5/115.8*100)});
 it('marks every export as synthetic in both languages and emits English digits',()=>{for(const en of [false,true]){const csv=previewCsv('demo-holding',3,en);expect(csv).toMatch(en?/SYNTHETIC PREVIEW/:/بيانات اصطناعية/);expect(csv).not.toMatch(/[٠-٩]/)}});
});
