import {describe,it,expect} from 'vitest';
import {SETUP_GROUPS,setupGroupState} from '../lib/financial-setup-presentation';
import type {FinancialSetupReadiness} from '../lib/financial-setup-readiness';
const ready={organizationId:'a',mode:'NEW',statuses:{organization:'READY',chart:'READY',fiscal:'READY',posting:'READY',banking:'READY',opening:'READY',users:'READY',regulatory:'NOT_STARTED',structure:'NOT_STARTED',review:'READY',finished:'READY'},ready:true,sourceChecked:true,certification:'READ_ONLY_SOURCE_PREFLIGHT'} as FinancialSetupReadiness;
describe('setup group presentation preserves independent source checks',()=>{
 it('shows checking instead of an empty or failed group while evidence loads',()=>{for(const group of SETUP_GROUPS)expect(setupGroupState(group,null,'NEW',[],'SA')).toBe('CHECKING');});
 it('accepts a server-verified zero opening for a new organization',()=>{expect(setupGroupState(SETUP_GROUPS[2],ready,'NEW',[],'SA')).toBe('COMPLETE');});
 it('cannot replace source approval with locally reviewed steps',()=>{const blocked={...ready,ready:false,statuses:{...ready.statuses,posting:'IN_PROGRESS' as const,review:'BLOCKED' as const}};expect(setupGroupState(SETUP_GROUPS[2],blocked,'NEW',['posting','review'],'SA')).toBe('IN_PROGRESS');expect(setupGroupState(SETUP_GROUPS[4],blocked,'NEW',['review'],'SA')).toBe('MISSING');});
 it('keeps legal review distinct from a certified completion',()=>{expect(setupGroupState(SETUP_GROUPS[1],ready,'NEW',['regulatory'],'SA')).toBe('REVIEWED');expect(setupGroupState(SETUP_GROUPS[0],ready,null,[],'SA')).toBe('MISSING');expect(setupGroupState(SETUP_GROUPS[0],ready,'NEW',[],null)).toBe('MISSING');});
});
