import {expect,it} from 'vitest';
import {investmentWorkspaceQuery} from './investment-workspace-scope';
it('does not carry remembered organization/group values into personal API requests',()=>{
 expect(investmentWorkspaceQuery('PERSONAL','stale-organization',true)).toBe('scope=PERSONAL');
});
it('requires an explicit banner company and preserves group reads only when selected',()=>{
 expect(investmentWorkspaceQuery('ORGANIZATION','',true)).toBeNull();
 expect(investmentWorkspaceQuery('ORGANIZATION','company')).toBe('scope=ORGANIZATION&organization_id=company');
 expect(investmentWorkspaceQuery('ORGANIZATION','company',true)).toBe('scope=ORGANIZATION&organization_id=company&group=1');
});
