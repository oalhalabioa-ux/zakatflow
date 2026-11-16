#!/usr/bin/env node
// Guard the cross-session deployment policy: branch pushes must not publish previews.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const rules = config.git?.deploymentEnabled;
assert.ok(rules && typeof rules === "object" && !Array.isArray(rules),
  "git.deploymentEnabled must be an explicit branch-rule object");
assert.equal(rules["**"], false, "All (including future) branches must be default-denied");
assert.equal(rules.main, true, "Approved main must remain the only auto-deployed branch");
const allowed = Object.entries(rules).filter(([, value]) => value === true).map(([key]) => key);
assert.deepEqual(allowed, ["main"], "No preview/QA/development branch may auto-deploy");
for (const [branch, value] of Object.entries(rules)) {
  assert.equal(typeof value, "boolean", `Invalid deployment boolean for ${branch}`);
}
assert.equal(config.ignoreCommand, undefined,
  "An ignored-build command is not a substitute for preventing quota-consuming deployments");
assert.notEqual(config.github?.autoJobCancellation, false,
  "Do not disable redundant queued build cancellation");
console.log("Yaqeen deployment policy OK: only main auto-deploys; all preview branches denied.");
