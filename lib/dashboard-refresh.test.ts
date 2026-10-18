import {afterEach,describe,expect,it,vi} from 'vitest';
import {subscribeDashboardRefresh} from './dashboard-refresh';
afterEach(()=>vi.useRealTimers());
describe('dashboard background refresh',()=>{
 it('coalesces a focus burst and the timer into a single refresh',()=>{
  vi.useFakeTimers();const target=new EventTarget(),refresh=vi.fn();const stop=subscribeDashboardRefresh(refresh,{target,isVisible:()=>true});
  target.dispatchEvent(new Event('focus'));expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(30000);for(let i=0;i<5;i++)target.dispatchEvent(new Event('focus'));
  expect(refresh).toHaveBeenCalledTimes(1);stop();vi.advanceTimersByTime(60000);target.dispatchEvent(new Event('focus'));expect(refresh).toHaveBeenCalledTimes(1);
 });
 it('keeps a slow request running and resumes only after it completes',()=>{
  vi.useFakeTimers();const target=new EventTarget();let busy=false;const refresh=vi.fn(()=>{busy=true});const stop=subscribeDashboardRefresh(refresh,{target,isVisible:()=>true,isBusy:()=>busy});
  vi.advanceTimersByTime(30000);vi.advanceTimersByTime(60000);target.dispatchEvent(new Event('focus'));expect(refresh).toHaveBeenCalledTimes(1);
  busy=false;target.dispatchEvent(new Event('focus'));expect(refresh).toHaveBeenCalledTimes(2);stop();
 });
 it('skips hidden tabs and refreshes once when they return',()=>{
  vi.useFakeTimers();const target=new EventTarget(),refresh=vi.fn();let visible=false;const stop=subscribeDashboardRefresh(refresh,{target,isVisible:()=>visible});
  vi.advanceTimersByTime(60000);expect(refresh).not.toHaveBeenCalled();visible=true;target.dispatchEvent(new Event('focus'));expect(refresh).toHaveBeenCalledTimes(1);stop();
 });
});
