import {it,expect} from 'vitest';
import {dashboardScopeHref} from './dashboard-scope-navigation';
it('preserves report settings while replacing organization and consolidation level',()=>{
 const href=dashboardScopeHref('ar',{year:'2026',month:'2026-10',asset_basis:'MARKET',scenario:'UPSIDE',plan:'saved-plan',scope:'PERSONAL',organization:'old',unrelated:'ignored'},'new',false),q=new URLSearchParams(href.split('?')[1]);
 expect(href.startsWith('/ar/dashboard?')).toBe(true);expect(q.get('scope')).toBe('ORGANIZATION');expect(q.get('organization')).toBe('new');expect(q.get('level')).toBe('COMPANY');expect(q.get('year')).toBe('2026');expect(q.get('month')).toBe('2026-10');expect(q.get('asset_basis')).toBe('MARKET');expect(q.get('scenario')).toBe('UPSIDE');expect(q.get('plan')).toBe('saved-plan');expect(q.has('unrelated')).toBe(false);
});
it('consolidation does not retain a conflicting single-plan budget scope',()=>{
 expect(new URLSearchParams(dashboardScopeHref('en',{budget_scope:'PLAN'},'org',true).split('?')[1]).has('budget_scope')).toBe(false);
 expect(new URLSearchParams(dashboardScopeHref('en',{budget_scope:'PLAN'},'org',false).split('?')[1]).get('budget_scope')).toBe('PLAN');
});
