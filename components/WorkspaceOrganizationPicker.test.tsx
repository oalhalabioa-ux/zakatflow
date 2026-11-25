import React from 'react';
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import WorkspaceOrganizationPicker from './WorkspaceOrganizationPicker';

vi.stubGlobal('React',React);
const organizations=[{id:'company-a',name:'Company A'},{id:'company-b',name:'Company B',parent_organization_id:'company-a'}];
const render=(value:string,group=false)=>renderToStaticMarkup(<WorkspaceOrganizationPicker ar={false} organizations={organizations} value={value} group={group} onChange={()=>{}} onGroupChange={()=>{}}/>);

it('renders an unmatched company as the selected empty option instead of a native first-company fallback',()=>{
 const html=render('unavailable-company');
 expect(html).toMatch(/<option value=""[^>]*selected=""/);
 expect(html).not.toMatch(/<option value="company-[ab]"[^>]*selected=""/);
 expect([...html.matchAll(/<button\b[^>]*>/g)].every(([button])=>button.includes('disabled=""'))).toBe(true);
});

it('keeps an authorized selection and group display after resolving the catalog',()=>{
 const html=render('company-a',true);
 expect(html).toMatch(/<option value="company-a"[^>]*selected=""/);
 const group=[...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].find(([button])=>button.includes('Company and subsidiaries'))?.[0];
 expect(group).toContain('aria-pressed="true"');
 expect(group).not.toContain('disabled=""');
});
