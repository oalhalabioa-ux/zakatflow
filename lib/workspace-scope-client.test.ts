import {afterEach,expect,it,vi} from 'vitest';
import {updateClientWorkspaceScope} from './workspace-scope-client';
afterEach(()=>vi.unstubAllGlobals());
function browser(path:string,search=''){const value={location:{pathname:'/ar/'+path,search},history:{pushState:vi.fn(),replaceState:vi.fn()},dispatchEvent:vi.fn()};vi.stubGlobal('window',value);return value;}
it('changes every client-owned scope through history and the filter event',()=>{
 for(const path of ['assets','assets/dashboard','investments','reports','cash-and-banks','receivables','payables','debt-report','financial-position']){
  const b=browser(path,'?scope=PERSONAL&tab=statement');expect(updateClientWorkspaceScope('ORGANIZATION')).toBe(true);
  expect(b.history.pushState).toHaveBeenCalledWith(null,'','/ar/'+path+'?scope=ORGANIZATION&tab=statement');
  const event=b.dispatchEvent.mock.calls[0][0] as CustomEvent;expect(event.type).toBe('zf-workspace-scope');expect(event.detail).toBe('ORGANIZATION');
 }
});
it('does not add duplicate history when the scope is unchanged',()=>{const b=browser('assets','?scope=PERSONAL');updateClientWorkspaceScope('PERSONAL');expect(b.history.pushState).not.toHaveBeenCalled();expect(b.dispatchEvent).toHaveBeenCalledOnce();});
it('supports source synchronization without adding a back-stack entry',()=>{const b=browser('assets');updateClientWorkspaceScope('ORGANIZATION',true);expect(b.history.replaceState).toHaveBeenCalledOnce();expect(b.history.pushState).not.toHaveBeenCalled();});
it('leaves server-owned dashboard reporting and other modules on their original navigation path',()=>{for(const path of ['dashboard','loans','vat']){const b=browser(path);expect(updateClientWorkspaceScope('PERSONAL')).toBe(false);expect(b.history.pushState).not.toHaveBeenCalled();expect(b.dispatchEvent).not.toHaveBeenCalled();}});
