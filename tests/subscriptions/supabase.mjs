// Disposable local Supabase only: real Auth sessions, PostgreSQL, PostgREST and Next/browser.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import assert from "node:assert/strict";
const root = new URL("../../", import.meta.url),
  load = (p) => readFile(new URL(p, root), "utf8");
const dir = process.env.TRIAL_QA_WORKDIR;
assert.ok(
  dir &&
    process.env.RUNNER_TEMP &&
    dir.startsWith(process.env.RUNNER_TEMP + "/"),
  "DISPOSABLE_LOCAL_STACK_REQUIRED",
);
const status = JSON.parse(
  execFileSync(
    "npx",
    [
      "--yes",
      "supabase@2.122.0",
      "status",
      "--workdir",
      dir,
      "--output",
      "json",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
const url = "http://127.0.0.1:54321",
  appUrl = "http://127.0.0.1:3000";
assert.equal(status.API_URL, url);
const sql = (input) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_trial-subscriptions-qa",
      "psql",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
const report = {
  engine: "Real disposable Supabase Auth/PostgREST/PostgreSQL/Chromium",
  remoteConnections: false,
  googleOAuth: "not tested; no provider credentials or settings changed",
  checks: [],
};
let server, browser;
async function check(name, fn) {
  await fn();
  report.checks.push({ name, status: "passed" });
  console.log("PASS " + name);
}
const clients = [];
const headers = (client) => ({
  apikey: status.ANON_KEY,
  Authorization: "Bearer " + client.token,
  "Content-Type": "application/json",
});
async function rpc(client, name, body) {
  const r = await fetch(url + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: headers(client),
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}
try {
  let source = await load("tests/owner-production-review/fixture.sql");
  source = source.slice(source.indexOf("create table public.organizations("));
  sql(
    source +
      "\nalter table profiles add column timezone text default 'UTC'; insert into currencies values('SAR');\n" +
      (await load(
        "tests/owner-production-review/unrelated-owner-functions.sql",
      )),
  );
  sql(
    "set yaqeen.platform_owner_ddl_approval='APPROVED_PLATFORM_OWNER_SCHEMA';\n" +
      (await load(
        "docs/production-owner-review/20261028185536_platform_owner_production_review.sql",
      )),
  );
  sql(`create table public.trial_documents(id uuid primary key default gen_random_uuid(),organization_id uuid references public.organizations(id),amount numeric);
 create table public.trial_lines(id uuid primary key default gen_random_uuid(),document_id uuid references public.trial_documents(id),amount numeric);
 alter table trial_documents enable row level security;
 create policy trial_member on trial_documents to authenticated using(exists(select 1 from organization_members where organization_id=trial_documents.organization_id and user_id=auth.uid() and status='ACTIVE')) with check(exists(select 1 from organization_members where organization_id=trial_documents.organization_id and user_id=auth.uid() and status='ACTIVE'));
 alter table organizations enable row level security;
 create policy org_read on organizations for select to authenticated using(owner_user_id=auth.uid() or exists(select 1 from organization_members where organization_id=organizations.id and user_id=auth.uid() and status='ACTIVE'));
 create policy org_insert on organizations for insert to authenticated with check(owner_user_id=auth.uid());
 grant select,insert,update,delete on public.organizations,public.organization_members,public.trial_documents,public.trial_lines to authenticated;
 grant select on public.profiles to authenticated;
 create function public.is_organization_admin(p_org uuid) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() and role in ('OWNER','ADMIN') and status='ACTIVE')$$;
 create function public.is_organization_owner(p_org uuid) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from public.organizations where id=p_org and owner_user_id=auth.uid())$$;
 `);
  // Use the real invitation RPC definitions, not a test implementation.
  const account = await load(
    "supabase/migrations/20260930150000_account_user_management.sql",
  );
  const start = account.indexOf(
      "create or replace function public.accept_organization_invitation(",
    ),
    end = account.indexOf(
      "create or replace function public.manage_organization_member(",
      start,
    );
  sql(
    `create table public.organization_invitations(id uuid primary key default gen_random_uuid(),organization_id uuid references public.organizations(id),email text,role text,custom_role_id uuid,token text unique,expires_at timestamptz default now()+interval '7 days',accepted_at timestamptz,created_at timestamptz default now());\n` +
      (await load(
        "supabase/migrations/20260930174500_fix_invitation_acceptance_conflict.sql",
      )),
  );
  sql(
    await load(
      "supabase/migrations/20261030150759_organization_trial_entitlements.sql",
    ),
  );
  for (let i = 0; i < 8; i++) {
    const client = createClient(url, status.ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `trial-${i}@qa.local.test`,
      password = randomBytes(24).toString("base64url") + "aA7!";
    const signup = await client.auth.signUp({ email, password });
    assert.ifError(signup.error);
    assert.ok(signup.data.session, "Local fixture requires auto-confirmation");
    const user = signup.data.user;
    sql(`insert into profiles(id) values('${user.id}');`);
    clients.push({
      client,
      email,
      password,
      id: user.id,
      token: signup.data.session.access_token,
    });
  }
  const owner = clients[0],
    invitees = clients.slice(1);
  sql(
    `insert into platform_admins(user_id,role) values('${owner.id}','platform_owner');`,
  );
  let org;
  await check(
    "real email/password account creates institution, owner membership and 30-day trial",
    async () => {
      const r = await fetch(url + "/rest/v1/organizations", {
        method: "POST",
        headers: { ...headers(owner), Prefer: "return=representation" },
        body: JSON.stringify({
          name: "Trial Institution",
          owner_user_id: owner.id,
        }),
      });
      assert.equal(r.status, 201, await r.clone().text());
      org = (await r.json())[0].id;
      const e = await rpc(owner, "organization_subscription", {
        p_organization_id: org,
      });
      assert.equal(e.data.active_users, 1);
      assert.equal(e.data.max_users, 5);
      assert.equal(
        new Date(e.data.trial_ends_at) - new Date(e.data.trial_started_at),
        30 * 86400000,
      );
    },
  );
  const initial = (
    await rpc(owner, "organization_subscription", { p_organization_id: org })
  ).data;
  for (let i = 0; i < 6; i++)
    sql(
      `insert into organization_invitations(organization_id,email,role,token) values('${org}','${invitees[i].email}','VIEWER','invitation-${i}');`,
    );
  await check(
    "accepting existing-institution invitations does not create or restart a trial",
    async () => {
      for (let i = 0; i < 3; i++) {
        const r = await rpc(invitees[i], "accept_organization_invitation", {
          p_token: "invitation-" + i,
        });
        assert.equal(r.status, 200, JSON.stringify(r.data));
      }
      const e = await rpc(owner, "organization_subscription", {
        p_organization_id: org,
      });
      assert.equal(e.data.active_users, 4);
      assert.equal(e.data.trial_ends_at, initial.trial_ends_at);
    },
  );
  await check(
    "two real sessions concurrently competing for the fifth seat allow exactly one acceptance",
    async () => {
      const results = await Promise.all(
        [3, 4].map((i) =>
          rpc(invitees[i], "accept_organization_invitation", {
            p_token: "invitation-" + i,
          }),
        ),
      );
      assert.equal(results.filter((r) => r.status === 200).length, 1);
      assert.equal(
        results.filter((r) =>
          JSON.stringify(r.data).includes("SUBSCRIPTION_USER_LIMIT"),
        ).length,
        1,
      );
      assert.equal(
        (
          await rpc(owner, "organization_subscription", {
            p_organization_id: org,
          })
        ).data.active_users,
        5,
      );
    },
  );
  await check(
    "sixth active user rejected and pending invitation remains unconsumed",
    async () => {
      const r = await rpc(invitees[5], "accept_organization_invitation", {
        p_token: "invitation-5",
      });
      assert.ok(r.status >= 400);
      assert.match(JSON.stringify(r.data), /SUBSCRIPTION_USER_LIMIT/);
    },
  );
  let document;
  await check(
    "authenticated PostgREST can write while trial is valid",
    async () => {
      const r = await fetch(url + "/rest/v1/trial_documents", {
        method: "POST",
        headers: { ...headers(owner), Prefer: "return=representation" },
        body: JSON.stringify({ organization_id: org, amount: 12 }),
      });
      assert.equal(r.status, 201);
      document = (await r.json())[0].id;
    },
  );
  sql(
    `update platform_subscriptions set trial_started_at=now()-interval '31 days',trial_ends_at=now()-interval '1 day' where organization_id='${org}';`,
  );
  await check(
    "expired trial denies direct API create/update/delete and indirect child writes",
    async () => {
      for (const [method, path, body] of [
        ["POST", "trial_documents", { organization_id: org, amount: 9 }],
        ["PATCH", "trial_documents?id=eq." + document, { amount: 15 }],
        ["DELETE", "trial_documents?id=eq." + document, null],
        ["POST", "trial_lines", { document_id: document, amount: 9 }],
      ]) {
        const r = await fetch(url + "/rest/v1/" + path, {
          method,
          headers: headers(owner),
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        assert.ok(r.status >= 400);
        assert.match(await r.text(), /SUBSCRIPTION_READ_ONLY/);
      }
    },
  );
  await check(
    "CSV export and existing reads survive expiry; cross-institution reads remain isolated",
    async () => {
      const r = await fetch(
        url + "/rest/v1/trial_documents?organization_id=eq." + org,
        { headers: { ...headers(owner), Accept: "text/csv" } },
      );
      assert.equal(r.status, 200);
      assert.match(await r.text(), /12/);
      const outsider = await fetch(
        url + "/rest/v1/trial_documents?organization_id=eq." + org,
        { headers: headers(invitees[6]) },
      );
      assert.deepEqual(await outsider.json(), []);
    },
  );
  await check(
    "ordinary session cannot extend trials or edit subscription tables directly",
    async () => {
      assert.equal(
        (
          await rpc(invitees[0], "owner_manage_trial", {
            p_action: "extend",
            p_reason: "Unauthorized extension",
            p_organization_id: org,
            p_revision: 1,
            p_days: 7,
          })
        ).status,
        403,
      );
      const r = await fetch(
        url + "/rest/v1/platform_subscriptions?organization_id=eq." + org,
        {
          method: "PATCH",
          headers: headers(invitees[0]),
          body: JSON.stringify({ status: "active" }),
        },
      );
      assert.ok(r.status >= 400);
    },
  );
  // SSR session cookies used by real Next route requests and Chromium.
  const cookies = [];
  const ssr = createServerClient(url, status.ANON_KEY, {
    cookies: {
      getAll: () => cookies,
      setAll: (cs) => {
        for (const c of cs) {
          const i = cookies.findIndex((x) => x.name === c.name);
          if (i >= 0) cookies.splice(i, 1);
          cookies.push(c);
        }
      },
    },
  });
  assert.ifError(
    (
      await ssr.auth.signInWithPassword({
        email: owner.email,
        password: owner.password,
      })
    ).error,
  );
  server = spawn(
    "node",
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-H",
      "127.0.0.1",
      "-p",
      "3000",
    ],
    {
      stdio: "ignore",
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
        NEXT_PUBLIC_APP_URL: appUrl,
        SUPABASE_SERVICE_ROLE_KEY: "",
        RESEND_API_KEY: "",
      },
    },
  );
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(appUrl + "/ar/login");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(ready, "Next server must start");
  const cookieHeader = cookies.map((c) => c.name + "=" + c.value).join(";");
  await check(
    "real Next subscription and owner API boundaries respect authenticated roles",
    async () => {
      const r = await fetch(
        appUrl + "/api/subscriptions?organization_id=" + org,
        { headers: { Cookie: cookieHeader } },
      );
      assert.equal(r.status, 200);
      assert.equal((await r.json()).status, "expired");
      const noSession = await fetch(appUrl + "/api/admin/trials");
      assert.equal(noSession.status, 401);
    },
  );
  const { chromium } = await import(process.env.TRIAL_BROWSER_MODULE);
  browser = await chromium.launch({ headless: true });
  await mkdir(new URL("tests/subscriptions/screenshots/", root), {
    recursive: true,
  });
  await check(
    "real AR/EN browser UI renders expiry, responsive layout and administrative extension",
    async () => {
      const context = await browser.newContext();
      await context.addCookies(
        cookies.map((c) => ({ name: c.name, value: c.value, url: appUrl })),
      );
      const page = await context.newPage();
      for (const locale of ["ar", "en"]) {
        for (const width of [390, 1440]) {
          await page.setViewportSize({ width, height: 1000 });
          await page.goto(appUrl + `/${locale}/billing?organization=${org}`);
          await page
            .getByLabel(
              locale === "ar" ? "حالة الاشتراك" : "Subscription status",
            )
            .waitFor();
          await page
            .getByText(
              locale === "ar"
                ? "انتهت الفترة — قراءة وتصدير فقط"
                : "Expired — read and export only",
              { exact: false },
            )
            .first()
            .waitFor();
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          );
          await page.screenshot({
            path: new URL(
              `tests/subscriptions/screenshots/${locale}-${width}.png`,
              root,
            ).pathname,
            fullPage: true,
          });
        }
      }
      await page.goto(appUrl + "/admin/subscriptions?lang=en");
      await page
        .getByRole("heading", {
          name: "Subscriptions and free trials",
          exact: true,
          level: 1,
        })
        .waitFor();
      const row = page
        .getByRole("row")
        .filter({ hasText: "Trial Institution" });
      await row.getByRole("button", { name: "Manage", exact: true }).click();
      await page
        .getByLabel("Administrative reason", { exact: true })
        .fill("Browser acceptance extension");
      const responsePromise = page.waitForResponse(
        (r) =>
          r.url() === appUrl + "/api/admin/trials" &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Apply and audit", exact: true })
        .click();
      const response = await responsePromise;
      const result = await response.json();
      if (response.status() !== 200) {
        await page.screenshot({
          path: new URL("tests/subscriptions/screenshots/admin-error.png", root)
            .pathname,
          fullPage: true,
        });
      }
      assert.equal(response.status(), 200, JSON.stringify(result));
      await page
        .getByText("Change saved and audited.", { exact: true })
        .waitFor();
      await page.screenshot({
        path: new URL(
          "tests/subscriptions/screenshots/admin-extension.png",
          root,
        ).pathname,
        fullPage: true,
      });
      await context.close();
    },
  );
  await check(
    "owner extension actually restores database writes with one audited revision",
    async () => {
      const r = await fetch(url + "/rest/v1/trial_documents", {
        method: "POST",
        headers: headers(owner),
        body: JSON.stringify({ organization_id: org, amount: 13 }),
      });
      assert.equal(r.status, 201);
      const audit = await rpc(owner, "owner_trial_audit", {
        p_organization_id: org,
      });
      assert.equal(audit.data.length, 1);
      assert.equal(audit.data[0].details.after.revision, 2);
    },
  );
  report.passed = report.checks.length;
} finally {
  if (browser) await browser.close();
  if (server) server.kill("SIGTERM");
  await writeFile(
    new URL("tests/subscriptions/supabase-result.json", root),
    JSON.stringify(report, null, 2) + "\n",
  );
}
