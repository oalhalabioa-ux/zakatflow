# Approved A tabs and B plan editor

User approved the white underline tabs from proposal A and the grouped plan form from proposal B. All owner subscription views now use the same white evenly divided tab strip with the theme accent underline, including request and payment views. The Yaqeen palette is navy #10243A, royal gold #C6A35D, pale gold #F5EBD6, pearl #F3F5F7, mist #E9EDF1 and white. Positive states use #E3F3E9 / #267451; rejection uses #FBECEC and muted red; expiry uses gray. Other themes share these semantics and layouts with their own accent tokens. Elegant follows the separately approved pearl/champagne palette in PR #323 without importing its conflicting layout rules.

The plan dialog has separate information/pricing and capability-card sections, with all existing required fields and module grants retained. Core capabilities stay immutable and remain submitted as hidden fields. At narrower widths both sections and the form fields stack. Native modal focus, Escape, busy state and focus restoration remain intact. The sticky action footer contains one navy primary save button and a quiet cancel action. Owner plan errors are localized instead of displaying backend codes.

The compact rail retains the original approved artwork and collapse preference, adds subscription child links synchronized with the page tabs, and uses a distinct globe/language control. All admin pages share top bar placement, spacing, table style and mobile field labels. Independent dashboard metrics are requested in parallel. A route loading state is included. Register filters/pagination and the selected tab persist in a namespaced URL, including back/forward, language navigation and reload; native history changes avoid rerunning server data requests on tab/filter changes. Saved decision notes derive their color from the request status rather than a generic error class.

No migrations, provider setup, Google OAuth changes or live database writes are required. Existing owner checks, subscription actions, revisions, seat limits, immutable quotes, RLS and disabled payment collection are retained. All newly created plans in acceptance tests are synthetic and confined to disposable local Supabase.

Separate draft PR #323 is unchanged. Its Elegant-only CSS was reviewed; it is based on main before #322 and must be adapted to this shared token system before its own release. This change does not merge or publish that draft.

Validation: 938 unit tests and TypeScript. The existing real Supabase/Auth/API regression is extended with uniform tab geometry, real plan creation via the new form, checkbox bounds, mobile modal sizes, URL filter restoration, sidebar/tab parity, language context and approved-decision green state. Review exact-head workflow results and screenshot artifacts in the PR before release.

## Review refinement — selection hierarchy

The latest user feedback supersedes the original all-white active A treatment: the active main navigation and subscription tabs now have navy fill, pale-gold text and a pale-gold 3px bottom line. Detail tabs use pale-gold fill, navy text and a navy bottom line. The remaining tab layout and B plan form are unchanged. Table headings use cool mist gray; selected records use warm ivory #FFF8E8 and a navy leading edge. Hover no longer replaces the selected state with the same gray as the heading. Metric icons have no colored background tile. Checkbox selections use navy. The browser matrix asserts these states in all four themes, including hover.

Scope remains owner administration only. Publication to the live platform and merging remain on hold pending user preview approval.
