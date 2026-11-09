# Automatic subsidiary-account mapping — local acceptance record

Status: implementation checkpoint; NOT approved for production merge or deployment.
No hosted migrations, deployments or production mutations were performed for this change.

## Implemented

- New chart accounts inherit existing, tenant-scoped source templates into an unapproved draft. Source, event, component, cash direction and the opposite account are preserved.
- Supports canonical classification templates and specialized system classifications. Generated classifications never become templates for further generation or accidental generic-source fallbacks.
- Cash accounts remain selected from the actual voucher/bank link. Retained earnings remains governed by fiscal configuration. OPEX keeps its integrated classification/category creation path.
- Explicit synchronization covers existing accounts. Repeated synchronization is idempotent and preserves edited rules. Approved policies and closed fiscal years remain unchanged.
- Generated revenue/asset/investment/tax categories are usable through the existing Liquidity classification link. Category names distinguish their source purpose; renaming synchronizes labels.
- Manual Liquidity payments and receipts reuse the original recorded payable/receivable account, the selected bank and reversal snapshots.
- The UI distinguishes a missing source template from an incomplete detailed counterpart. An account appearing in a rule is not sufficient proof of complete mapping.

## Evidence and boundaries

- Full unit suite before the last coverage assertion: 253 files, 1508 passing tests, one skipped. The added coverage assertion passes separately.
- Isolated PostgreSQL/WASM inheritance fixture: 21 generic groups, three delegated workflows, lifecycle/idempotence, permissions, conflict rollback and ten source factory definitions. These are inheritance-mechanism tests, NOT certification of 24 native financial workflows.
- Detailed posting fixture: original liability and receivable account preservation, selected banks, reversals and historical resolutions.
- Full-schema rollback SQL acceptance added to the existing disposable CI job: `tests/qa-financial-account-rule-inheritance.sql`. It uses actual chart and policy commands; it has NOT been executed locally because this runtime lacks the Docker/PostgreSQL runner.
- Final Arabic/English UI fixture: 13 checks passed, zero JavaScript errors, including synchronization and both incomplete-mapping notices. This is mocked interface acceptance, not authenticated backend or RLS certification.
- Production build completed successfully. Final targeted tests and type validation cover subsequent source-inheritance guard changes.
- Ambiguous legacy ASSET_LIFECYCLE/ADJUSTMENT/BASE templates are explicitly excluded from automatic inheritance and tested in both TypeScript and PostgreSQL/WASM.

## Unresolved source-template coverage

Read-only QA inspection found templates referencing roots 1000, 1100, 1400, 1500, 1600, 2100, 2300, 4100, 6100 and 8100. This is observed coverage of one organization, not a universal catalog.

Absent templates in that policy: 1200, 1300, 1590, 1700, 1800, 2200, 2400, 2500, 3100, 3200, 3300, 5100, 6200 and 7100. Root 3300 intentionally uses fiscal closing. Other missing groups require their actual source contracts and appropriate templates; the inheritance engine cannot safely invent them.

The asset lifecycle ambiguity identified in the initial checkpoint is addressed by the follow-up below. Historical BASE events are not reclassified or rewritten. Missing native workflows outside this follow-up remain unverified.

## Gates before merge

1. Complete missing native source-role templates and account selection for each applicable group, including financing, advances and source-to-leaf account selection.
2. Execute full-schema fresh-install and upgrade CI, including the new actual-RPC acceptance SQL; preserve existing organization snapshots.
3. Execute authenticated isolated QA cycles for recognition, settlement, partial payments, reversals, fiscal closing, tenant isolation and permissions.
4. Obtain the user's preview-upload instruction before publishing to the stable QA URL. No deployment is implied by this local checkpoint.

## Follow-up: native asset source and settlement roles

Implemented locally after the initial checkpoint:

- New depreciation, disposal, sale gain/loss, net book value, accumulated depreciation release and output VAT lines have explicit source roles. Canonical source-book gross cost and depreciation must reconcile with the current lots before a new operation can be prepared.
- Fixed/intangible asset releases use the fixed-asset control. Investment sale/disposal roles are separate and release the investment control. Other/unclassified asset classes retain distinct unsupported signatures rather than being silently routed to fixed assets.
- Twelve explicit lifecycle draft templates and three acquisition cost/recoverable-VAT templates were added. Existing approved rules are not replaced; missing templates are available through the existing missing-default-rules action, then saved for review. Ambiguous account leaves remain unresolved.
- A previously ambiguous PL/pgSQL variable in reversal was qualified; actual reversal replay now restores saved lots.
- New single-obligation asset payments/collections reconcile every original captured line against its normalized source, including sale loss and VAT or acquisition VAT. The signed original receivable/payable total must equal the original obligation before its detailed account is reused. Partial payments preserve the actual bank and investing activity. Different counterparty accounts, missing original snapshots, amount mismatches and unsupported source roles fail atomically. Multiple obligations require a separate allocation implementation.
- Current generic cash/control rules cannot rewrite historical settlement snapshots. Reversal continues to reuse the recorded snapshot.
- User-facing asset reconciliation and settlement error messages were added; no layout redesign was included in this follow-up.

Validation of the final follow-up:

- 26 targeted TypeScript tests pass across default rules, policy initialization and compiled asset statements. The earlier full suite passed 1512 tests with one skip before the final investment-role and native-settlement additions; it is not represented as a final full-suite run.
- Real prepare/apply and canonical book functions pass an isolated PostgreSQL/WASM replay: depreciation, partial loss sale with VAT, gain sale, investment role separation, unsupported-class isolation, disposal, fully depreciated disposal, reversal, stale/retroactive rejection, authenticated wrapper and cross-organization denial. Event-command persistence and permission functions are fixture adapters, so this is not hosted RLS certification.
- The real posting capture trigger passes a separate PostgreSQL/WASM replay: native sale/acquisition net obligation, partial payment, original subaccount and bank, reversal, mismatch rollback and ambiguity rejection, alongside existing manual revenue/expense/tax/asset settlement cases. Source adapters in this fixture are mocked.
- Full-schema native lifecycle acceptance is registered in the disposable CI workflow. A separate isolated replay job verifies both scripts and schema deltas. These remote jobs have not run for this local commit; Docker is unavailable in this runtime.
- Both migrations are registered in fresh-schema, upgrade and schema-catalog verification paths. No hosted database, preview, production, or remote git branch was changed.

Remaining before claiming full task completion: native financing/advance/group templates, complete source-to-subsidiary-account selection, real multi-obligation allocation where required, full-schema install/upgrade acceptance, and authenticated QA financial cycles. This checkpoint is NOT production-merge approval.

## Follow-up: advance classification and finance recognition

- Advance RECORD and APPLY commands now select their exact dedicated classification code, organization, type and active state. Unrelated generic classifications and generated child classifications cannot be substituted. Missing dedicated classifications stop creation.
- Added native draft templates for supplier advance cash out (1300), customer advance cash in (2400), accrued financing cost (7100 against 2100) and financing return (1100 against 4100). Dedicated source classifications do not acquire unrelated generic console signatures.
- Advance application has no guessed default clearing rule: it still requires reconciliation with the actual original advance and invoice legs. Combined principal/finance installment settlement remains pending. These recognition templates do not certify either full workflow.
- 37 targeted tests pass, covering exact supplier/customer and both clearing classifications, missing/inactive classification rejection, template coverage, missing-account refusal and preservation of saved rules. TypeScript validation passes. These are service/logic fixtures, not full-schema or hosted QA acceptance.
- Automatic depreciation calculation is explicitly deferred at the user's request; see `depreciation-calculation-follow-up.md` for the saved scope and acceptance items.

## Follow-up: original-account advance clearing and split installments

This follow-up supersedes the preceding pending implementation notes for advance application and combined installments, but does not certify their hosted end-to-end lifecycle.

- New ACTUAL advance applications derive both posting accounts from the original advance and invoice snapshots. Canonical source line IDs, classifications, signs and amounts are reconciled; their net obligation account must match the original obligation total. Supplier and customer applications produce noncash clearing only. Ambiguous accounts, missing snapshots, another organization, or mismatched allocations stop capture atomically.
- Newly prepared financing installments contain distinct principal/finance source lines linked to their actual obligations. Strict request metadata permits only these component roles and only for a scoped financing installment. Generic payable/receivable classification selection now requires the exact canonical code.
- At capture, each component must match exactly one saved payment allocation and the correct original contract/source. Principal and charge clear their independently recorded subsidiary accounts. Principal payment/collection defaults to financing/investing cash activity; finance charges default to operating, retaining an explicit matching policy activity. The bank comes from the posted voucher. Reversals reuse saved legs.
- Previously executed payments are not rewritten. A prior unexecuted aggregate installment without the required components is rejected with an actionable cancel/recreate message.
- PostgreSQL/WASM replay passes supplier/customer clearing, partial applications, no extra bank movement, source mismatch rollback, cross-organization refusal, payable and receivable installments, distinct principal/charge accounts, amount/component mismatch refusal and reversals. The existing asset and manual settlement cases also pass. Source adapters in the replay are fixtures; this is not full-schema native RPC or hosted RLS acceptance.
- Final full unit suite: 256 files, 1527 passing tests, one skipped. TypeScript validation and canonical migration digest verification pass (263 files). Both new migrations and catalog deltas are registered in fresh-install/upgrade verification. No remote actions or hosted changes were made.

Remaining: finish source-to-subsidiary selection for all applicable native account groups (including initial debt/funding classification and specialized source roles), run complete-schema install/upgrade and native command acceptance, and conduct authenticated isolated QA cycles. Docker remains unavailable in this runtime. Do not treat local replay as production merge approval. Depreciation calculation remains deferred.

## Follow-up: initial debt principal source

- New debt contracts select the exact active DEBT_PRINCIPAL_ASSET/LIABILITY classification, retaining the exclusion of generated account-specific classifications. Missing/inactive canonical classifications do not fall back to another source purpose.
- Source components distinguish OPENING from NEW and retain the validated debt category. Default NEW loan funding maps loans receivable to 1200, loans payable to 2200, and employee advances to 1100, with bank selection remaining voucher-based. Opening balances have no fabricated movement counterpart and no automatic BASE remapping.
- Actual create_debt_contract replay passes new payable/receivable loans, employee advances and opening supplier balances, exact classification selection in the presence of unrelated classes, installment totals, committed draft status, idempotent replay, changed-request rejection, foreign organization denial and inactive classification rejection. Auth, permission, event persistence and digest are fixture adapters, not hosted acceptance.
- 55 targeted default/inheritance/policy tests and TypeScript validation pass. Native debt-role replay and its catalog delta are registered in CI and the fresh/upgrade schema catalog. Prior final full-suite evidence remains 1527 passing tests and one skipped, before this follow-up; no full-suite rerun is claimed.
- Remaining native-source review includes refunds/rescheduling and their clearing classifications, source-specific subsidiary selection across the remaining groups, and verification that opening debt categorization agrees with the new funding roles. Full-schema and authenticated QA gates remain open. No deployment or remote branch write occurred.


## Follow-up: refund identity and nonposting schedule changes

- Actual `prepare_debt_operation` now creates/selects the dedicated active clearing classification and tags new supplier/customer refunds and date-only reschedules. It preserves existing source permissions and does not modify historical events.
- New refunds must match the saved executed request, original advance obligation, one decreasing adjustment, exact amount, sign and cash direction. Capture reuses the original 1300/2400 subsidiary account and the voucher's actual bank. Unsupported/mismatched old pending requests stop rather than guess; the UI explains the required review/recreation.
- Verified new reschedules have no obligations, allocations or cash settlements. Their explicit source role and executed request allow exclusion from both accounting normalization and posting capture. Historical untagged events are untouched and require separate review.
- Capture now also reads REVERSAL_OF directly from the saved link, even when the normalizer's date range excludes the original event. This prevents dynamic adapters from interpreting a later reversal as a new refund/application/installment. It does not certify that every native reversal command emits the correct accounting components.
- Actual prepare-command PostgreSQL/WASM replay passes supplier/customer refund payloads, exact classification, original obligation adjustment, replay, over-refund and foreign-organization refusal; reschedule emits a noncash role without new obligations. Event persistence, permissions and digest remain isolated adapters.
- Actual capture and normalizer replay passes original account/bank refund routing, mismatch rollback, later-date reversal without an inline original ID, and exclusion of only verified new reschedules. All prior asset, advance, installment and manual source regression cases pass. This fixture does not execute native post_debt_operation or certify hosted RLS.
- Full unit suite: **256 files, 1528 passed, one skipped**. TypeScript and canonical history checks pass. The final SQL-only capture adjustment passed the PostgreSQL replay after that suite. Canonical history has 265 migrations; source and posting catalog deltas are registered for fresh/upgrade CI. No remote branch, deployment or hosted database was changed.

### Open merge blockers — not completed

1. Native debt reversal emits a generic clearing line. The real normalizer/captured original signature and cash direction must be tested together, including multi-component financing reversals; fixture reversals must not be mistaken for native-command acceptance.
2. Existing opening adapters use 1200/2200 for every debt contract, including supplier/employee categories. Correct category-aware classification must agree across historical source, first-day opening, candidates and closed-year snapshots; preserve explicit assignments and approved history. New OPENING debt events also require full-cycle verification against detailed posting capture to avoid manufacturing a movement counterpart.
3. Complete source-to-subsidiary selection for all supported native groups, including ambiguous multiple leaves and multi-obligation settlements, remains unverified. Mechanism coverage for account groups does not imply every native source workflow is complete.
4. Full-schema fresh installation, upgrade/catalog comparison, actual native posting commands, authenticated organization isolation and financial-statement/closing reconciliation must pass on a disposable complete Supabase stack. Docker, psql and PostgreSQL server are unavailable in the current runtime. No remote run was triggered because pushing/deploying could violate the user's preview hold.
5. Automatic depreciation calculation remains explicitly deferred, not an omitted implementation in this scope; see the saved follow-up document.

**Decision:** not production-merge ready. The completed local changes above are reviewable; no claim of full task completion or native end-to-end acceptance is made.


## Follow-up: category-aware opening sources

- New tagged debt sources now derive their reporting root from the immutable event-line category: O_AR_LOAN to 1200, O_AP_LOAN to 2200, other supported institutional receivable categories to 1100, and other payable categories to 2100. These are reporting groups, not a claim of unique subsidiary-account selection.
- Historical source rows, first-day opening resolution and opening candidates use the same function. Historical untagged contracts retain their previous grouping; there is no bulk rewrite. Explicit opening assignments and closed-year snapshot branches are preserved exactly.
- PostgreSQL/WASM executes 24 category/mode routes, opposite-side refusal, cross-organization fallback and historical fallback. Installed function patches and catalog hashes are replayed with prior fiscal/cash patches. This validates the category function and patch preservation, not a complete native opening transaction or RLS cycle.
- Registered the migration and four catalog objects in fresh-schema/upgrade verification and the isolated CI job. Canonical manifest has 266 migrations. No deployment or remote action occurred.
- This resolves the category-selection part of blocker 2 above for newly tagged sources. Historical categorization remediation, OPENING event capture/exclusion, complete subsidiary selection, native reversal execution, and full-schema/authenticated QA remain open. Last complete unit suite evidence remains 1528 passed and one skipped; no unrelated suite rerun is claimed for this SQL-only change.


## Native reversal investigation: end-to-end lineage blocker

The attempted aggregate reversal expansion was deliberately NOT retained: capture/normalizer fixtures alone passed, but the real statement source contract rejects reused original line IDs across events (`DUPLICATE_SOURCE_LINE`). Inventing virtual UUIDs would also fail independent RLS lookup in `observeCanonicalJournalLineage`; bypassing that check is not acceptable.

Confirmed constraints for the complete fix:
- `prepare_debt_operation` currently emits one aggregate clearing line, whereas the original may have multiple principal/finance components.
- `cash_reverse_financial_settlement_atomic` requires opposite raw cash direction and disallows revenue/expense/asset/VAT recognition classifications. Simply copying original line classifications is not a valid universal reversal command.
- The report normalizer needs the original accounting classification and cash direction with a negative recognition sign. Raw reverse-voucher direction must not be negated twice.
- Every component needs a real unique saved reversal line, a validated link to its original line, and source/amount/classification verification through the independently authorized lineage observer.
- `post_debt_operation` currently reads one line for amount-based permissions. A component-based command must validate permissions against the full reversal total, not the first component.

Required implementation/acceptance spans native prepare/post commands, approval fingerprints, cash reversal guards, report normalization, captured posting resolution and RLS lineage verification. It must cover cash-in, cash-out, noncash advance application, multi-part financing, request replay, later report windows and full rollback. Do not merge an isolated normalizer fix. This remains an explicit merge blocker; no experimental reversal migration or catalog delta was left in the canonical history.
