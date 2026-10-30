# Migration history and magic-link follow-up

The user reported that a quick sign-in link returned to login after its confirmation button, then confirmed that a later attempt opened successfully. No Google/OAuth/provider configuration or authentication route was changed in this follow-up. Incident logs showed rejected used/missing one-time tokens and a successful OTP verification followed seconds later by a repeated verification. This supports used/superseded links as a possible cause; it does not prove the cause of every mobile attempt. Existing invalid-refresh-cookie errors are covered by added separate-browser mobile acceptance cases. Never collect or publish a user's email link, token or cookie for diagnosis.

Both post-merge workflows for #316 subsequently completed successfully. This follow-up addresses the remaining Supabase integration failure: the active migration directory did not correspond to the installed history. 201 older installed versions were missing locally; replaying the old local filenames would be unsafe.

## Canonical history

`supabase/migrations` now restores the 217 applied version/name pairs from read-only Production migration metadata. `supabase/migration-history.json` records installed SQL MD5 and repository SHA-256 for each file. The original 166 repository files remain under `supabase/archive/pre-reconciliation-20261030`, outside the automatic migration directory. This preserves proposed variants and historical test fixtures without presenting them as unapplied Production migrations.

215 canonical files retain the exact installed SQL bytes. The purchase-numbering migration retains its exact installed body inside an explicit transaction wrapper: its table lock relied on the Management API transaction, while the CLI requires BEGIN/COMMIT in the file. The manifest/verifier records and unwraps this single compatibility wrapper before comparing the installed digest. One historical one-off test-record cleanup has no schema effects and is represented by a documented no-op; its two record identifiers are not published or replayed in a fresh database. Its installed digest remains in the manifest. No customer rows, auth identities, SMTP credentials, provider configuration or API keys are included in the canonical source package.

This change does not apply, revert, delete or globally repair any hosted migration history. The already verified subscription history correction from #316 is retained. Immediately before merge, the installed versions/digests must match this manifest again; new drift blocks release. Once matched, the automatic Production integration has zero pending migration files and should perform no DDL or data mutation.

## Required verification

`node tests/migration-history/verify-files.mjs` checks the complete canonical file list and every digest. The isolated history workflow starts a new local Supabase instance with all 217 migrations, compares 3,414 observed schema-object fingerprints (columns, constraints, indexes, functions, policies, RLS and triggers), verifies no customer/owner records are seeded, and exercises real Auth/PostgREST trial creation, cash-account writes, expiry/export, owner denial and audited extension against the complete historical financial schema. It destroys that database afterward. No shared QA/Production fallback is allowed.

The existing subscription workflow retains its minimal synthetic compatibility fixtures; archived paths are explicitly used where those fixtures target the earlier proposed source. The new full-history test covers the actual canonical source. The auth workflow additionally opens a fresh magic link in a separate mobile browser context, both clean and with revoked refresh cookies, and verifies persistence after reload and in another tab.

The branch disables automatic Vercel deployment; PR builds use local placeholders. No new paid resources or external test emails are enabled. Native mobile/PWA storage sharing is not claimed by browser viewport tests; separate browser profiles do not automatically share sessions.

Final run IDs, integration conclusion and release evidence are recorded in the follow-up PR before closure.
