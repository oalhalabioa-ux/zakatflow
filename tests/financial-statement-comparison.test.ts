import {describe,it,expect} from 'vitest';
import {priorStatementPeriod,statementChange,validStatementComparison} from '../lib/financial-statement-comparison';
import {normalizeStatementSource} from '../lib/financial-statement-source';
import evidence from './financial-reporting/qa-live-opening-snapshot.json';
describe('Actual statement comparison',()=>{
 it('shows correct directions and expense favorability without creating a fake percent over zero',()=>{expect(statementChange('120','100')).toMatchObject({direction:'up',tone:'positive',text:'+20.00%'});expect(statementChange('120','100',true)).toMatchObject({direction:'up',tone:'negative'});expect(statementChange('80','100',true)).toMatchObject({direction:'down',tone:'positive',text:'-20.00%'});expect(statementChange('50','0')).toMatchObject({direction:'up',text:'+50.00',percentage:null});expect(statementChange('-50','-100')?.text).toBe('+50.00%');expect(statementChange('50',undefined)).toBeUndefined()});
 it('clamps leap days to the comparable prior-year date',()=>{expect(priorStatementPeriod('2024-02-29','2024-12-31')).toEqual({from:'2023-02-28',to:'2023-12-31'})});
 it('rejects mismatched organizations, currencies or periods',()=>{const raw=evidence.snapshots[0].payload,s=normalizeStatementSource(raw,{organization:raw.organizationId,from:raw.from,to:raw.to}),prior=structuredClone(s);Object.assign(prior.statements,{from:'2025-01-01',to:'2025-12-31'});expect(validStatementComparison(s,prior)).toBe(prior);prior.statements.organizationId='other';expect(validStatementComparison(s,prior)).toBeNull();expect(validStatementComparison(s,s)).toBeNull()});
});
