# Actual-session RPC acceptance runner

Run from the repository root with Node 20+:

```sh
node scripts/owner-rpc-acceptance.mjs
```

Use the public legacy anon key for **weucywfwbdnomtlkjurl** only, either at the prompt or in NEXT_PUBLIC_SUPABASE_ANON_KEY. Never supply a service-role key. The script rejects a different project or key role before sending a network request.

Enter the password for `rpc-qa-test-20261028@example.invalid` at the hidden terminal prompt. Do not put the password in shell arguments, chat, source files, or the report. Existing browser-auth forms do not transfer their credentials to this independent runner.

The runner verifies the real sign-in identity and requires owner_authorized() to return false before testing any protected RPC. All eleven protected RPCs must return HTTP 403 and SQLSTATE 42501. The two mutation RPCs receive only null parameters, which cannot create a valid plan or subscription transition even if authorization regresses. Tests stop at the first unexpected response. No financial entries are created.

Finally it signs out this test session and checks that its refresh token is rejected. The sanitized result is written to owner-rpc-acceptance-result.json only after all checks succeed. It contains statuses, function names and timestamps, without passwords, access tokens, refresh tokens or returned business data. This proves refresh revocation, not immediate invalidation of previously issued bearer tokens.

Run the runner's offline safety tests separately:

```sh
node --test scripts/owner-rpc-acceptance.checks.mjs
```

**Merge gate:** Offline tests are not live acceptance. Do not mark the actual-session RPC gate passed or merge until a successful live report has been reviewed. No live password is available to the current terminal execution environment; the user's password was supplied only to browser-auth. The runner therefore has not yet been executed against QA.

The currently reviewed remote application commit is c7ccd1ae808b7a3f6db93ab9d8384ae52eb25207; subsequent branch commits have documented acceptance checks. The main branch was d2178c2a6933001e56165566796caf8b64b5f126 at review. A main merge may trigger a Production deployment; do not initiate that merge while the user's prohibition on Production deployment remains unresolved.
