import {describe,it,expect,vi} from 'vitest';
import {activateSidebarDrawer} from '../lib/sidebar-drawer';

function fixture() {
  const doc = Object.assign(new EventTarget(), {
    activeElement: null as unknown,
    body: {style: {overflow: 'auto'}},
    documentElement: {style: {overflow: ''}},
  });
  const element = (visible = true) => ({
    ownerDocument: doc, inert: false, isConnected: true,
    getClientRects: () => visible ? [{}] : [],
    closest: () => null,
    focus() {doc.activeElement = this},
  });
  const closeButton = element();
  const link = element();
  const trigger = element();
  const workspace = element();
  const sidebar = Object.assign(element(), {
    querySelector: () => closeButton,
    querySelectorAll: () => [closeButton, link],
  });
  const close = vi.fn();
  trigger.focus();
  const activate = () => activateSidebarDrawer(sidebar as unknown as HTMLElement, workspace as unknown as HTMLElement, trigger as unknown as HTMLElement, close);
  const key = (key: string, shiftKey = false) => {
    const event = Object.assign(new Event('keydown', {cancelable: true}), {key, shiftKey});
    doc.dispatchEvent(event);
    return event;
  };
  return {doc,element,closeButton,link,trigger,workspace,sidebar,close,activate,key};
}

describe('temporary sidebar drawer', () => {
  it('isolates the background and restores existing scroll and inert state', () => {
    const f=fixture(); f.workspace.inert=true;
    const cleanup=f.activate();
    expect(f.doc.activeElement).toBe(f.closeButton);
    expect(f.workspace.inert).toBe(true);
    expect(f.doc.body.style.overflow).toBe('hidden');
    cleanup();
    expect(f.workspace.inert).toBe(true);
    expect(f.doc.body.style.overflow).toBe('auto');
    expect(f.doc.documentElement.style.overflow).toBe('');
    expect(f.doc.activeElement).toBe(f.trigger);
  });
  it('wraps keyboard focus in both directions and closes with Escape', () => {
    const f=fixture(); const cleanup=f.activate();
    expect(f.key('Tab',true).defaultPrevented).toBe(true);
    expect(f.doc.activeElement).toBe(f.link);
    f.key('Tab'); expect(f.doc.activeElement).toBe(f.closeButton);
    f.key('Escape'); expect(f.close).toHaveBeenCalledOnce();
    cleanup(); f.key('Escape'); expect(f.close).toHaveBeenCalledOnce();
  });
  it('recovers focus from outside the drawer and ignores hidden controls', () => {
    const f=fixture(); f.sidebar.querySelectorAll=()=>[f.closeButton,f.element(false),f.link];
    const cleanup=f.activate(); f.trigger.focus(); f.key('Tab');
    expect(f.doc.activeElement).toBe(f.closeButton);
    f.key('Tab',true); expect(f.doc.activeElement).toBe(f.link);
    cleanup(); expect(f.workspace.inert).toBe(false);
  });
  it('keeps focus in the drawer when no links are available', () => {
    const f=fixture(); f.sidebar.querySelectorAll=()=>[];
    const cleanup=f.activate(); f.key('Tab');
    expect(f.doc.activeElement).toBe(f.sidebar); cleanup();
  });
});
