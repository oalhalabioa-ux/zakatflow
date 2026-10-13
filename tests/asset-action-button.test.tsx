import React from 'react';
import {vi} from 'vitest';
vi.stubGlobal('React',React);
import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import ActionButton from '../components/ActionButton';
describe('asset action accessibility',()=>{
 it('renders a named icon with hover and keyboard labels',()=>{const html=renderToStaticMarkup(<ActionButton icon="details" label="التفاصيل والإجراءات"/>);expect(html).toContain('aria-label="التفاصيل والإجراءات"');expect(html).toContain('title="التفاصيل والإجراءات"');expect(html).toContain('aria-hidden="true"');expect(html).toContain('action-hover-label')});
 it('preserves submit and disabled behavior',()=>{const html=renderToStaticMarkup(<ActionButton type="submit" disabled icon="save" label="حفظ"/>);expect(html).toContain('type="submit"');expect(html).toContain('disabled=""')});
});
