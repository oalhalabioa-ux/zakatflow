import type {WorkspaceScope} from '../topbar-navigation';

/**
 * Presentation-only safety boundary until the server-side tenant/share model exists.
 * Historical account drafts have PERSONAL ownership; never implicitly promote them
 * into an organization's portfolio based on the topbar scope.
 *
 * NOT an authorization boundary: organizational studies/shares must be queried from
 * the server with membership, role, entitlement and organization-specific RLS checks.
 */
export function accountDraftsVisibleInScope<T>(
 accountDrafts: readonly T[],
 scope: WorkspaceScope
): readonly T[] {
 return scope === 'PERSONAL' ? accountDrafts : [];
}
