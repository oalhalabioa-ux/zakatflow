import React from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';

const current=vi.hoisted(()=>({path:'/ar/settings/personal-setup',scope:'PERSONAL' as 'PERSONAL'|'ORGANIZATION'}));
vi.stubGlobal('React',React);
vi.mock('next/navigation',()=>({usePathname:()=>current.path}));
vi.mock('@/hooks/useWorkspaceScope',()=>({useWorkspaceScope:()=>[current.scope,()=>{}]}));
vi.mock('@/lib/workspace-organization',()=>({rememberedOrganization:()=> 'previous-company'}));
import SettingsFrame from './SettingsFrame';

function settings(locale='ar'){
  return renderToStaticMarkup(<SettingsFrame locale={locale}><p>Account content</p></SettingsFrame>);
}
function links(html:string){
  return [...html.matchAll(/href="([^"]+)"/g)].map(match=>new URL(match[1].replaceAll('&amp;','&'),'https://yaqeen.test'));
}
beforeEach(()=>{current.path='/ar/settings/personal-setup';current.scope='PERSONAL';});

it('keeps the personal setup journey and its destinations personal in both languages',()=>{
  for(const locale of ['ar','en']){
    current.path=`/${locale}/settings/personal-setup`;
    const html=settings(locale),targets=links(html);
    expect(html).toContain(locale==='ar'?'رحلة الإعداد الشخصي':'Set up your personal workspace');
    expect(targets.map(url=>url.pathname)).toEqual([`/${locale}/settings/personal-setup`,`/${locale}/settings/system`]);
    expect(targets.every(url=>url.searchParams.get('scope')==='PERSONAL')).toBe(true);
    expect(targets.every(url=>!url.searchParams.has('organization'))).toBe(true);
    expect(html).not.toContain(locale==='ar'?'رحلة إعداد المؤسسة':'Set up your organization');
    expect(html).toContain('Account content');
  }
});

it('shows account preferences in the current scope without linking a personal user into company setup',()=>{
  current.path='/en/settings/system';
  let targets=links(settings('en'));
  expect(targets.map(url=>url.pathname)).toEqual(['/en/settings/personal-setup','/en/settings/system']);
  expect(targets.every(url=>url.searchParams.get('scope')==='PERSONAL')).toBe(true);
  current.scope='ORGANIZATION';
  targets=links(settings('en'));
  expect(targets).toHaveLength(6);
  expect(targets.every(url=>url.searchParams.get('scope')==='ORGANIZATION')).toBe(true);
  expect(targets.find(url=>url.pathname==='/en/settings/system')?.searchParams.has('organization')).toBe(false);
});

it('retains all six institutional settings sections and their company setup heading',()=>{
  current.path='/en/settings/financial/setup';current.scope='ORGANIZATION';
  const html=settings('en');
  expect(html).toContain('Set up your organization');
  expect(links(html).map(url=>url.pathname)).toEqual([
    '/en/settings/financial/setup','/en/settings','/en/settings/regulatory',
    '/en/settings/financial','/en/settings/team','/en/settings/system',
  ]);
  expect(html).not.toContain('Set up your personal workspace');
});
