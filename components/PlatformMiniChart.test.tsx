import React from 'react';
import {describe,it,expect,vi} from 'vitest';
vi.stubGlobal('React',React);
import {renderToString} from 'react-dom/server';
import PlatformMiniChart from './PlatformMiniChart';

describe('PlatformMiniChart hydration',()=>{
 it('renders each SVG title as one text node for the browser parser',()=>{
  const html=renderToString(<PlatformMiniChart values={[12,34]} label="Assets" bars/>);
  const titles=[...html.matchAll(/<title>([\s\S]*?)<\/title>/g)].map(match=>match[1]);
  expect(titles).toHaveLength(2);
  expect(titles[0]).toMatch(/^1: /);
  expect(titles[1]).toMatch(/^2: /);
  for(const title of titles)expect(title).not.toContain('<');
 });
});
