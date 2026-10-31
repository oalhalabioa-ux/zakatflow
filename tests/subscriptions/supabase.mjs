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
  // Settings/account fixture mirrors the existing self-owned profile/preferences APIs.
  sql(`alter table public.profiles add column name text default 'QA User',add column phone text,add column base_currency text default 'SAR',add column locale text default 'en',add column calendar_type text default 'GREGORIAN',add column nisab_standard text default 'SILVER',add column zakat_method_id uuid;
  alter table public.profiles enable row level security;
  create policy profile_self on public.profiles to authenticated using(id=auth.uid()) with check(id=auth.uid());
  grant update on public.profiles to authenticated;
  create table public.user_settings(user_id uuid primary key references public.profiles(id),allocation_method text default 'FIFO',notifications_enabled boolean default true,assessment_reminders boolean default true,theme text default 'system',updated_at timestamptz default now());
  alter table public.user_settings enable row level security;
  create policy preferences_self on public.user_settings to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
  grant select,insert,update on public.user_settings to authenticated;
  alter table public.currencies add column name_ar text,add column name_en text,add column symbol text,add column decimals integer default 2,add column active boolean default true;
  insert into public.currencies(code) values('USD');grant select on public.currencies to authenticated;
  create policy org_update on public.organizations for update to authenticated using(owner_user_id=auth.uid()) with check(owner_user_id=auth.uid());`);
  // Use the real invitation RPC definitions, not a test implementation.
  const account = await load(
    "supabase/archive/pre-reconciliation-20261030/20260930150000_account_user_management.sql",
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
        "supabase/migrations/20260930151445_fix_invitation_acceptance_conflict.sql",
      )),
  );
  sql(
    await load(
      "supabase/migrations/20261030150759_organization_trial_entitlements.sql",
    ),
  );
  sql(await load('supabase/migrations/20261030223910_configurable_subscription_plans.sql'));
  sql(await load('tests/subscriptions/plan-customer-notice.sql'));
  sql(`create table public.vat_profiles(id uuid primary key default gen_random_uuid(),organization_id uuid unique references organizations(id),registration_status text not null, tax_registration_number text,registered_name text,registration_date date,filing_frequency text not null,standard_rate numeric not null default 15,period_start_month integer default 1,seller_street text,seller_building_number text,seller_district text,seller_additional_number text,seller_city text,seller_postal_code text,created_by uuid references profiles(id),updated_at timestamptz default now());
  alter table public.vat_profiles enable row level security;
  create policy vat_settings_read on public.vat_profiles for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=vat_profiles.organization_id and m.user_id=auth.uid() and m.status='ACTIVE'));
  create policy vat_settings_insert on public.vat_profiles for insert to authenticated with check(public.is_organization_admin(organization_id));
  create policy vat_settings_update on public.vat_profiles for update to authenticated using(public.is_organization_admin(organization_id)) with check(public.is_organization_admin(organization_id));
  grant select,insert,update on public.vat_profiles to authenticated;
  create trigger vat_settings_subscription_guard before insert or update or delete on public.vat_profiles for each row execute function subscription_private.guard_write();`);
  sql(await load('supabase/migrations/20261031054539_subscription_requests_and_owner_console.sql'));
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
    sql(`insert into profiles(id) values('${user.id}');insert into user_settings(user_id) values('${user.id}');`);
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
  await (await import('./owner-navigation.mjs')).ownerNavigation({browser,cookies,appUrl,status,ordinary:invitees[0],owner,sql,check});
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
          await page.locator('[data-plan="professional_monthly"]').waitFor();
          assert.equal(await page.locator('.pricing-card').count(),2);
          await page.getByRole('button',{name:locale==='ar'?'سنوي':'Yearly',exact:true}).click();
          await page.locator('[data-plan="advanced_yearly"]').waitFor();
          assert.ok((await page.locator('[data-plan="advanced_yearly"]').innerText()).replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[٬,]/g,'').includes('3990'));
          await page.getByRole('button',{name:locale==='ar'?'شهري':'Monthly',exact:true}).click();

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
      await page.getByRole('button',{name:'Plan definitions',exact:true}).click();
      await page.getByRole('heading',{name:'Plans and pricing',exact:true}).waitFor();
      await page.getByRole('cell',{name:'Professional',exact:true}).first().waitFor();
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.emulateMedia({reducedMotion:'reduce'});
    const luminance=c=>{const rgb=c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
      const readable=(fg,bg)=>{const l=[luminance(fg),luminance(bg)].sort((a,b)=>b-a);return (l[0]+.05)/(l[1]+.05)>=4.5};
      for(const [theme,label] of [['yaqeen','Yaqeen'],['elegant','Elegant'],['modern','Modern'],['classic','Classic']]){
       await page.getByRole('button',{name:label,exact:true}).click();
       await page.waitForFunction(t=>document.documentElement.dataset.ownerTheme===t,theme);
       await page.getByRole('button',{name:'＋ Add plan',exact:true}).click();
       const colors=await page.locator('.owner-shell select').evaluateAll(items=>items.map(el=>({bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el).color,option:getComputedStyle(el.options[0]).backgroundColor,optionFg:getComputedStyle(el.options[0]).color})));
       for(const c of colors){assert.notEqual(c.bg,'rgba(0, 0, 0, 0)');assert.notEqual(c.option,'rgba(0, 0, 0, 0)');assert.ok(readable(c.fg,c.bg)&&readable(c.optionFg,c.option),theme+' dropdown contrast '+JSON.stringify(c));}
       const tabs=await page.locator('.owner-tabs a').evaluateAll(items=>items.map(a=>({fg:getComputedStyle(a).color,bg:getComputedStyle(a).backgroundColor==='rgba(0, 0, 0, 0)'?getComputedStyle(a.parentElement).backgroundColor:getComputedStyle(a).backgroundColor})));
       for(const c of tabs)assert.ok(readable(c.fg,c.bg),theme+' navigation contrast '+JSON.stringify(c));
       await page.screenshot({path:new URL(`tests/subscriptions/screenshots/admin-${theme}.png`,root).pathname,fullPage:true});
       await page.keyboard.press('Escape');
      }
      await page.getByRole('button',{name:'Yaqeen',exact:true}).click();
      await page.getByRole('button',{name:'＋ Add plan',exact:true}).click();
      const form=page.locator('.plan-manager form');
      await form.locator('.owner-plan-advanced summary').click();
      for(const [name,value] of Object.entries({code:'qa_custom',family:'qa_custom',name_ar:'باقة مخصصة للاختبار',name_en:'Custom acceptance plan',price:'79',max_users:'3',reason:'Browser custom plan acceptance'}))await form.locator(`[name="${name}"]`).fill(value);
      await form.locator('[name="features"][value="module:budgets"]').uncheck();
      await form.locator('[name="features"][value="module:investments"]').uncheck();
      await form.locator('[name="is_published"]').check();
      const saved=page.waitForResponse(r=>r.url()===appUrl+'/api/admin/trials/plans'&&r.request().method()==='POST');
      await form.getByRole('button',{name:'Save plan',exact:true}).click();assert.equal((await saved).status(),200);
      await page.getByRole('cell',{name:'Custom acceptance plan',exact:true}).waitFor();

      await page
        .getByRole("heading", {
          name: "Subscriptions and plans",
          exact: true,
          level: 1,
        })
        .waitFor();
      await page.getByRole('button',{name:'Organization subscriptions',exact:true}).click();
      const row = page
        .getByRole("row")
        .filter({ hasText: "Trial Institution" });
      await row.getByRole("button", { name: "Manage", exact: true }).click();
      await page.screenshot({path:new URL('tests/subscriptions/screenshots/owner-institution-detail.png',root).pathname,fullPage:true});
      await page.locator('.institution-detail').getByRole('button',{name:'Members',exact:true}).click();await page.locator('.owner-member').first().waitFor();assert.equal(await page.locator('.owner-member').count(),5);
      await page.screenshot({path:new URL('tests/subscriptions/screenshots/owner-institution-members.png',root).pathname,fullPage:true});
      await page.locator('.institution-detail').getByRole('button',{name:'Subscription',exact:true}).click();
      await page.getByRole('button',{name:'Modify / renew subscription',exact:true}).click();

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
  await check('customer submits an immutable quote; owner activates it; customer sees the actual active plan',async()=>{
    const context=await browser.newContext();await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:appUrl})));const page=await context.newPage();
    const created=await fetch(url+'/rest/v1/organizations',{method:'POST',headers:{...headers(owner),Prefer:'return=representation'},body:JSON.stringify({name:'Activation review institution',owner_user_id:owner.id})});assert.equal(created.status,201);const target=(await created.json())[0].id;
    await page.goto(appUrl+'/ar/billing?organization='+target);await page.locator('[data-plan="advanced_monthly"]').waitFor();
    assert.ok(!/[٠-٩]/.test(await page.locator('.pricing-grid').innerText()));
    await page.locator('[data-plan="advanced_monthly"]').getByRole('button',{name:'طلب تفعيل الباقة',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'طلب تفعيل باقة',exact:true});await dialog.waitFor();await dialog.getByLabel('رقم التواصل',{exact:true}).fill('+966500000000');await dialog.getByLabel('ملاحظات الطلب',{exact:true}).fill('Browser reviewed activation');
    assert.equal(await dialog.locator('input[type="radio"]').nth(1).isDisabled(),true);
    await page.screenshot({path:new URL('tests/subscriptions/screenshots/activation-request-modal.png',root).pathname,fullPage:false});
    const sent=page.waitForResponse(r=>r.url()===appUrl+'/api/subscriptions/requests'&&r.request().method()==='POST');await dialog.getByRole('button',{name:'إرسال طلب التفعيل',exact:true}).click();const response=await sent;assert.equal(response.status(),200);const request=await response.json();
    assert.equal(request.quote.price_amount,399);assert.equal((await rpc(owner,'organization_subscription',{p_organization_id:target})).data.status,'trialing');
    await page.goto(appUrl+'/admin/subscriptions?lang=en');await page.getByRole('button',{name:'Activation requests',exact:true}).click();
    const row=page.getByRole('row').filter({hasText:'Activation review institution'});await row.getByRole('button',{name:'View request',exact:true}).click();
    await page.getByLabel('Decision reason — visible to customer',{exact:true}).fill('Approved browser end to end test');await page.getByLabel('End date for approval — device timezone',{exact:true}).fill('2027-12-31T18:00');
    await page.screenshot({path:new URL('tests/subscriptions/screenshots/activation-owner-inbox.png',root).pathname,fullPage:true});
    const approved=page.waitForResponse(r=>r.url()===appUrl+'/api/admin/subscriptions/requests'&&r.request().method()==='POST');await page.getByRole('button',{name:'Approve and activate manually',exact:true}).click();assert.equal((await approved).status(),200);
    await page.goto(appUrl+'/en/billing?organization='+target);await page.getByText('Current active plan',{exact:true}).waitFor();await page.getByText('Activated',{exact:false}).first().waitFor();
    const state=(await rpc(owner,'organization_subscription',{p_organization_id:target})).data;assert.equal(state.status,'active');assert.equal(state.max_users,15);assert.equal(state.plan.price_amount,399);
    await page.screenshot({path:new URL('tests/subscriptions/screenshots/activation-current-plan.png',root).pathname,fullPage:true});
    await context.close();
  });
  await check('owner approved design parity in AR/EN, four platform palettes, collapsed rail at 150% density and mobile',async()=>{
    const response=await fetch(url+'/rest/v1/organizations',{method:'POST',headers:{...headers(owner),Prefer:'return=representation'},body:JSON.stringify({name:'شركة الأفق — طلب مراجعة',owner_user_id:owner.id})});assert.equal(response.status,201);const pendingOrg=(await response.json())[0].id;
    const catalog=(await rpc(owner,'subscription_plan_catalog',{})).data,advanced=catalog.plans.find(p=>p.code==='advanced_monthly');
    const pending=await rpc(owner,'subscription_activation_requests',{p_organization_id:pendingOrg,p_action:'submit',p_plan_id:advanced.id,p_phone:'+966500000000',p_notes:'Synthetic owner visual review'});assert.equal(pending.data.status,'pending');
    await (await import('./owner-visuals.mjs')).ownerVisuals({browser,cookies,appUrl,root});
  });
  await check('manual activation requires a selected plan and saves a valid UUID without exposing validator details',async()=>{
    const response=await fetch(url+'/rest/v1/organizations',{method:'POST',headers:{...headers(owner),Prefer:'return=representation'},body:JSON.stringify({name:'Manual activation regression',owner_user_id:owner.id})});assert.equal(response.status,201);const target=(await response.json())[0].id;
    const context=await browser.newContext();await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:appUrl})));const page=await context.newPage();await page.goto(appUrl+'/admin/subscriptions?lang=en');await page.getByRole('row').filter({hasText:'Manual activation regression'}).getByRole('button',{name:'Manage',exact:true}).click();await page.getByRole('button',{name:'Modify / renew subscription',exact:true}).click();
    const modal=page.getByRole('dialog');await modal.waitFor();assert.equal(await modal.locator('select[name="action"]').count(),1);await modal.getByLabel('Action',{exact:true}).selectOption('activate');await modal.getByLabel('Administrative reason',{exact:true}).fill('Manual activation regression acceptance');await modal.getByLabel('Paid subscription end',{exact:true}).fill('2027-12-31T18:00');let submissions=0;page.on('request',r=>{if(r.url()===appUrl+'/api/admin/trials'&&r.method()==='POST')submissions++;});await modal.getByRole('button',{name:'Apply and audit',exact:true}).click();assert.equal(submissions,0);assert.equal(await modal.locator('[name="plan_id"]').evaluate(e=>e.validity.valueMissing),true);
    const catalog=(await rpc(owner,'subscription_plan_catalog',{})).data,plan=catalog.plans.find(p=>p.code==='advanced_monthly');await modal.locator('[name="plan_id"]').selectOption(plan.id);assert.equal(await modal.locator('[name="max_users"]').inputValue(),'15');const saved=page.waitForResponse(r=>r.url()===appUrl+'/api/admin/trials'&&r.request().method()==='POST');await modal.getByRole('button',{name:'Apply and audit',exact:true}).click();assert.equal((await saved).status(),200);const state=(await rpc(owner,'organization_subscription',{p_organization_id:target})).data;assert.equal(state.status,'active');assert.equal(state.plan_id,plan.id);assert.equal(state.max_users,15);await context.close();
  });
  await check('settings separates account and users; organization switching preserves subscription scope and account preferences persist',async()=>{
    const jar=[];
    const ssr=createServerClient(url,status.ANON_KEY,{cookies:{getAll:()=>jar,setAll:values=>{for(const item of values){const i=jar.findIndex(x=>x.name===item.name);if(i>=0)jar.splice(i,1);jar.push(item)}}}});
    assert.ifError((await ssr.auth.signInWithPassword({email:owner.email,password:owner.password})).error);
    const context=await browser.newContext();await context.addCookies(jar.map(c=>({name:c.name,value:c.value,url:appUrl})));const page=await context.newPage();
    const second=await fetch(url+'/rest/v1/organizations',{method:'POST',headers:{...headers(owner),Prefer:'return=representation'},body:JSON.stringify({name:'Second institution',owner_user_id:owner.id})});assert.equal(second.status,201);const secondOrg=(await second.json())[0].id;
    await page.goto(appUrl+'/en/settings?organization='+secondOrg);
    await page.getByRole('heading',{name:'Organization details',exact:true}).waitFor();
    await page.getByLabel('Organization name',{exact:true}).waitFor();
    assert.equal(await page.locator('.subscription-banner').count(),0);
    assert.equal(await page.locator('.subscription-notice').count(),0);
    assert.equal(await page.locator('#corp-settings-nav a').count(),3);
    assert.ok((await page.locator('#corp-settings-nav a[href*="/billing"]').getAttribute('href')).includes('organization='+secondOrg));
    assert.equal(await page.locator('#corp-settings-nav a[href*="users"]').count(),0);
    assert.equal(await page.locator('.corp-sidebar-foot a').getAttribute('href'),'/en/account');
    assert.ok(await page.locator('#corp-primary-nav>a[href*="/users"]').count());
    await page.getByLabel('Selected organization',{exact:true}).selectOption(org);
    await page.waitForFunction(()=>document.querySelector('input[required]')?.value==='Trial Institution');
    await page.getByLabel('Legal name',{exact:true}).fill('Preserved legal organization');
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.getByText('Organization details saved.',{exact:true}).waitFor();
    await page.reload();await page.getByLabel('Legal name',{exact:true}).waitFor();assert.equal(await page.getByLabel('Legal name',{exact:true}).inputValue(),'Preserved legal organization');
    await page.getByRole('navigation',{name:'Settings sections'}).getByRole('link',{name:'Subscription & plans',exact:true}).click();
    await page.getByLabel('Subscription status',{exact:true}).waitFor();
    await page.getByRole('navigation',{name:'Settings sections'}).getByRole('link',{name:'System settings',exact:true}).click();
    await page.getByRole('heading',{name:'Organization system settings',exact:true}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('organization'),org);
    await page.getByRole('button',{name:'Configure invoicing',exact:true}).click();
    const vatDialog=page.getByRole('dialog',{name:'E-invoicing & ZATCA settings',exact:true});await vatDialog.waitFor();
    await vatDialog.getByLabel('Registered name',{exact:true}).fill('QA registered organization');
    await vatDialog.getByRole('button',{name:'Save settings',exact:true}).click();await page.getByText('Invoicing settings saved.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Configure invoicing',exact:true}).click();await vatDialog.waitFor();assert.equal(await vatDialog.getByLabel('Registered name',{exact:true}).inputValue(),'QA registered organization');
    await page.screenshot({path:new URL('tests/subscriptions/screenshots/system-zatca-modal.png',root).pathname,fullPage:false});await page.keyboard.press('Escape');

    sql(`update platform_subscriptions set trial_ends_at=now()-interval '1 day' where organization_id='${org}'`);
    await page.goto(appUrl+'/en/account');
    await page.getByLabel('Name',{exact:true}).fill('Saved account name');
    await page.getByLabel('Personal base currency',{exact:true}).selectOption('USD');
    await page.getByLabel('Time zone',{exact:true}).selectOption('Asia/Riyadh');
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.getByText('Your account preferences were saved.',{exact:true}).waitFor();
    await page.reload();await page.getByLabel('Name',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'Saved account name');
    assert.equal(await page.getByLabel('Personal base currency',{exact:true}).inputValue(),'USD');
    assert.equal(await page.getByLabel('Time zone',{exact:true}).inputValue(),'Asia/Riyadh');
    const state=(await rpc(owner,'organization_subscription',{p_organization_id:org})).data;assert.equal(state.revision,2);assert.equal(state.can_write,false);
    sql(`update platform_subscriptions set trial_ends_at=now()+interval '7 days' where organization_id='${org}'`);
    await page.screenshot({path:new URL('tests/subscriptions/screenshots/account-en-1440.png',root).pathname,fullPage:true});
    for(const locale of ['ar','en'])for(const width of [390,1440]){
      await page.setViewportSize({width,height:1000});await page.goto(appUrl+`/${locale}/settings?organization=${org}`);
      await page.getByLabel(locale==='ar'?'اسم المؤسسة':'Organization name',{exact:true}).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const layout=await page.locator('.settings-tabs').evaluate(nav=>{const links=[...nav.querySelectorAll('a')],widths=links.map(a=>a.getBoundingClientRect().width);const clone=links[0].cloneNode(true);nav.appendChild(clone);const four=[...nav.querySelectorAll('a')].map(a=>a.getBoundingClientRect().width);clone.remove();return {widths,four,icons:nav.querySelectorAll('a>svg[aria-hidden=true]').length,overflow:nav.scrollWidth>nav.clientWidth}});
      assert.equal(layout.icons,3);assert.ok(!layout.overflow);assert.ok(Math.max(...layout.widths)-Math.min(...layout.widths)<1);assert.equal(layout.four.length,4);assert.ok(Math.max(...layout.four)-Math.min(...layout.four)<1);
      await page.screenshot({path:new URL(`tests/subscriptions/screenshots/settings-${locale}-${width}.png`,root).pathname,fullPage:true});
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    const luminance=c=>{const rgb=c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
    for(const [theme,label] of [['yaqeen-business','Yaqeen Business'],['elegant','Elegant'],['modern','Modern'],['classic','Classic']]){
      await page.getByRole('group',{name:'Choose design',exact:true}).getByRole('button',{name:label,exact:true}).click();
      await page.locator('.corp-shell.theme-'+theme).waitFor();
      const colors=await page.locator('.settings-card').evaluateAll(items=>items.map(el=>({fg:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor})));
      for(const c of colors){const l=[luminance(c.fg),luminance(c.bg)].sort((a,b)=>b-a);assert.ok((l[0]+.05)/(l[1]+.05)>=4.5,theme+' settings card contrast '+JSON.stringify(c));}
      const tabs=await page.locator('.settings-tabs a').evaluateAll(items=>items.map(el=>({fg:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor==='rgba(0, 0, 0, 0)'?getComputedStyle(el.parentElement).backgroundColor:getComputedStyle(el).backgroundColor})));
      for(const c of tabs){assert.equal(c.fg,'rgb(255, 255, 255)');const l=[luminance(c.fg),luminance(c.bg)].sort((a,b)=>b-a);assert.ok((l[0]+.05)/(l[1]+.05)>=4.5,theme+' settings tab contrast '+JSON.stringify(c));}
      await page.screenshot({path:new URL(`tests/subscriptions/screenshots/settings-${theme}.png`,root).pathname,fullPage:true});
      await page.goto(appUrl+'/en/settings/system?organization='+org);await page.getByRole('button',{name:'Configure invoicing',exact:true}).click();
      const modal=page.getByRole('dialog',{name:'E-invoicing & ZATCA settings',exact:true});await modal.waitFor();
      const box=await modal.boundingBox();const viewport=page.viewportSize();assert.ok(Math.abs(box.x+box.width/2-viewport.width/2)<2,'System modal must be centered');assert.ok(box.x>=10&&box.x+box.width<=viewport.width-10);
      const surfaces=await page.locator('.system-settings .console-card,dialog[open].subscription-modal').evaluateAll(items=>items.map(el=>({fg:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor})));
      for(const c of surfaces){const l=[luminance(c.fg),luminance(c.bg)].sort((a,b)=>b-a);assert.ok((l[0]+.05)/(l[1]+.05)>=4.5,theme+' system surface contrast '+JSON.stringify(c));}
      await page.screenshot({path:new URL(`tests/subscriptions/screenshots/system-modal-${theme}.png`,root).pathname,fullPage:false});await page.keyboard.press('Escape');
      await page.goto(appUrl+'/en/settings?organization='+org);await page.getByLabel('Organization name',{exact:true}).waitFor();

    }
    await context.close();
  });
  await check(
    "fresh account completes real organization onboarding with a five-seat trial",
    async () => {
      const newcomer = clients[7],
        jar = [];
      const ssr = createServerClient(url, status.ANON_KEY, {
        cookies: {
          getAll: () => jar,
          setAll: (values) => {
            for (const item of values) {
              const index = jar.findIndex((x) => x.name === item.name);
              if (index >= 0) jar.splice(index, 1);
              jar.push(item);
            }
          },
        },
      });
      assert.ifError(
        (
          await ssr.auth.signInWithPassword({
            email: newcomer.email,
            password: newcomer.password,
          })
        ).error,
      );
      const context = await browser.newContext();
      await context.addCookies(
        jar.map((c) => ({ name: c.name, value: c.value, url: appUrl })),
      );
      const page = await context.newPage();
      await page.goto(appUrl + "/en/dashboard");
      await page
        .getByRole("heading", {
          name: "Create your organization and start your trial",
          exact: true,
        })
        .waitFor();
      await page
        .getByLabel("Organization name", { exact: true })
        .fill("Browser Onboarding Institution");
      await page
        .getByRole("button", {
          name: "Create organization and start trial",
          exact: true,
        })
        .click();
      await page.waitForURL(
        (u) =>
          u.pathname === "/en/dashboard" && u.searchParams.has("organization"),
      );
      const created = new URL(page.url()).searchParams.get("organization");
      const e = await rpc(newcomer, "organization_subscription", {
        p_organization_id: created,
      });
      assert.equal(e.status, 200);
      assert.equal(e.data.active_users, 1);
      assert.equal(e.data.max_users, 5);
      assert.equal(e.data.status, "trialing");
      assert.equal(await page.locator('.subscription-banner').count(),0);
      assert.equal(await page.locator('.subscription-notice').count(),0);
      await page.locator('.settings-module-toggle').click();
      await page.locator('#corp-settings-nav a[href*="/billing"]').click();
      await page.getByLabel("Subscription status").waitFor();
      assert.equal(new URL(page.url()).searchParams.get('organization'),created);
      await page.screenshot({
        path: new URL(
          "tests/subscriptions/screenshots/onboarding-created.png",
          root,
        ).pathname,
        fullPage: true,
      });
      await context.close();
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
