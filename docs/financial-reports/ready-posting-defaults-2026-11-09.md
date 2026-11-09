# Organization posting defaults — implementation and verification

Requested behavior: shared trade receivable/payable control accounts, party detail
in native modules, ready approved defaults without per-rule setup, optional edits.

Implemented:
- Persisted tenant-scoped semantic account roles. Reuse an exact existing matching
  account; occupied codes are never overwritten. Separate employee receivables,
  loans receivable, borrowing and advances from trade balances.
- Deterministic role-based proposals, detailed counterparts, voucher-selected cash.
  Only recognized legacy parents are repaired; explicit leaf edits are preserved.
- Automatic initialization/activation for an absent or empty approved policy.
  Existing drafts use a single batch-completion action, not per-rule approval.
- Atomic save/approve with existing authorization, self-approval, period, revision,
  source coverage and historical-resolution gates. Failure keeps the old approval.
- Newly added revenue/expense detail accounts inherit and auto-approve for an
  authorized actor after batch activation. Pre-existing manual drafts are retained.
  Unsupported templates or approval restrictions remain explicit, never fabricated.
- Optional edits still use a new version and retain the previous approved policy.

Verified:
- 63 targeted unit/service tests passed (defaults, inheritance, preservation and
  API authorization); TypeScript passed after the final UI changes.
- PostgreSQL/WASM: role reuse, occupied code, idempotency, closed periods, foreign
  tenant denial, atomic approval failure, stale version and detailed validation.
- Actual QA V2 RPCs/triggers: synthetic organization, shared control accounts,
  batch approval, consecutive new revenue and expense auto-approval, preserving a
  pending manual draft, revision rejection and no generated financial vouchers.
  SET CONSTRAINTS ALL IMMEDIATE passed; the entire fixture rolled back.
- Local browser fixture passed Arabic/English, optional editing/save/reload and
  unsaved-change protection, widths 1490/1280/768/390, no page errors/overflow.
  This UI fixture is not an authenticated end-to-end accounting certification.
- Canonical history: 268 migration files verified. New schema fingerprints recorded.
- Security advisor reviewed: authenticated SECURITY DEFINER RPC exposure is
  intentional and guarded; new anonymous/internal grants denied in tests. Existing
  unrelated advisor findings were not changed by this work.

Delivery state:
- Additive migration applied to QA V2 ubotbpjngtfvolthpfec only.
- No real organization accounts, balances, vouchers or policies changed.
- UI/API code remains local pending the user's preview-publish instruction.
- No Vercel deployment, Production migration, main merge, or new PR performed.
- Full fresh-schema CI will run when pushing is authorized; the new rollback and
  isolated checks have been added to its workflow.
