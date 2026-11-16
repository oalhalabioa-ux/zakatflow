# Actual-session RPC acceptance — passed

Tested commit: 949c52b00398dfa5969eca025f31375f7c8ea0ec.
QA project exclusively: weucywfwbdnomtlkjurl.
GitHub Actions run: https://github.com/oalhalabioa-ux/zakatflow/actions/runs/40746423774 (rerun, job 123022861148).
Verified at 2026-10-28T18:37:51.257Z.

Real password authentication of the ordinary test account succeeded. owner_authorized() returned false. All 11 protected RPC calls returned HTTP 403 and SQLSTATE 42501. The two mutation RPCs used null arguments; no valid plan or subscription change was requested. Logout succeeded and the refresh token was rejected afterward. All four runner safety checks passed. No passwords or tokens are recorded here.

Previous page acceptance: owner access, ordinary-user denial on seven pages, responsive layouts, themes and original logos passed as documented. TypeScript, build, and 789 unit tests previously passed.

Cleanup: deleting the temporary OWNER_QA_RPC_PASSWORD secret reached GitHub's Confirm access gate, requiring email verification. Deletion is NOT yet confirmed. No other secrets were accessed or modified.

Merge remains pending: user requested merge after acceptance, but earlier prohibition on Production deployment still applies; merging main must not silently deploy Production. No merge or new Vercel deployment occurred in this follow-up.
