import {describe,expect,it} from 'vitest';
import {feasibilityCsv} from './report-export';

describe('feasibility forecast CSV number formats',()=>{
 it('exports the tested dairy and water totals without floating-point tails',()=>{
  expect(feasibilityCsv([
   ['Year','Sales volume','Revenue','Variable costs','Currency'],
   [0,null,null,-120000,'USD'],
   [1,6912.000000000002,6432000,6912.000000000002,'USD'],
   [1,72000,455999.99999999994,191999.99999999997,'USD']
  ],['integer','quantity','money','money'])).toBe([
   '\uFEFF"Year","Sales volume","Revenue","Variable costs","Currency"',
   '"0","","","-120000.00","USD"',
   '"1","6912","6432000.00","6912.00","USD"',
   '"1","72000","456000.00","192000.00","USD"'
  ].join('\r\n'));
 });

 it('preserves fractional quantities and spreadsheet text protection',()=>{
  expect(feasibilityCsv(
   [[1,5.333333333333,-1.005,'=1+1'],[2,0.0014,-0.001,'a"b'],[3,Number.NaN,null,'USD']],
   ['integer','quantity','money']
  )).toBe('\uFEFF"1","5.333","-1.01","\'=1+1"\r\n"2","0.001","0.00","a""b"\r\n"3","","","USD"');
 });

 it('keeps existing unformatted CSV exports unchanged',()=>{
  expect(feasibilityCsv([[1,1.234567,-4.56789,'=SUM(A1)']]))
   .toBe('\uFEFF"1","1.234567","-4.56789","\'=SUM(A1)"');
 });
});
