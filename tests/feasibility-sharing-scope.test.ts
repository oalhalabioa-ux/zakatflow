import { describe, expect, it } from 'vitest';
import { currentWorkspaceScope, workspaceScopeHref } from '../lib/topbar-navigation';

describe.each(['feasibility/shared', 'feasibility/shared/review'])('%s', path => {
  it('displays the organization scope even after a personal workspace visit', () => {
    expect(currentWorkspaceScope(path, 'organization=qa', 'PERSONAL')).toBe('ORGANIZATION');
  });

  it('leaves the organization page when switching to personal', () => {
    expect(workspaceScopeHref('ar', path, 'organization=qa', 'PERSONAL')).toBe('/ar/dashboard?scope=PERSONAL');
  });
});
