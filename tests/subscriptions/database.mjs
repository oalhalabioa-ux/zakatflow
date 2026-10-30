// Synthetic local PostgreSQL tests. No hosted endpoint or credentials are accepted.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(
  process.env.TRIAL_PGLITE_MODULE ?? "@electric-sql/pglite"
);
const root = new URL("../../", import.meta.url),
  load = (p) => readFile(new URL(p, root), "utf8");
const db = new PGlite();
const report = [];
const owner = "11111111-1111-4111-8111-111111111111",
  user = "22222222-2222-4222-8222-222222222222",
  session = "33333333-3333-4333-8333-333333333333";
const legacy = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
async function identity(id = owner, sid = session) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: id,
      session_id: sid,
      role: "authenticated",
      user_metadata: { platform_owner: true },
    }),
  ]);
  await db.exec("set role authenticated");
}
async function admin() {
  await db.exec("reset role");
}
async function denied(sql, params = [], pattern = /SUBSCRIPTION_READ_ONLY/) {
  await assert.rejects(db.query(sql, params), pattern);
}
async function check(name, fn) {
  await fn();
  report.push({ name, status: "passed" });
  console.log("PASS " + name);
}
try {
  await db.exec(await load("tests/owner-production-review/fixture.sql"));
  await db.exec(
    await load("tests/owner-production-review/unrelated-owner-functions.sql"),
  );
  await db.exec(`alter table profiles add column timezone text default 'UTC';insert into auth.users(id,email,email_confirmed_at,created_at) values('${owner}','owner@trial.local',now(),now()-interval '1 year'),('${user}','user@trial.local',now(),now()-interval '1 year');insert into profiles(id) values('${owner}'),('${user}');insert into currencies values('SAR');insert into auth.sessions(id,user_id) values('${session}','${owner}');insert into organizations(id,owner_user_id,name) values('${legacy}','${owner}','Existing institution');insert into organization_members(organization_id,user_id,role) values('${legacy}','${owner}','OWNER');
 create table trial_documents(id uuid primary key default gen_random_uuid(),organization_id uuid references organizations(id),amount numeric);
 create table budget_plans(id uuid primary key default gen_random_uuid(),user_id uuid references profiles(id),organization_name text not null,amount numeric);
 create table trial_lines(id uuid primary key default gen_random_uuid(),document_id uuid references trial_documents(id),amount numeric);
 alter table trial_documents enable row level security;create policy document_member on trial_documents to authenticated using(exists(select 1 from organization_members where organization_id=trial_documents.organization_id and user_id=auth.uid())) with check(exists(select 1 from organization_members where organization_id=trial_documents.organization_id and user_id=auth.uid()));
 create table organization_invitations(id uuid primary key default gen_random_uuid(),organization_id uuid references organizations(id),email text,token text unique,accepted_at timestamptz,expires_at timestamptz default now()+interval '7 days');
 create function public.trial_post(p_org uuid) returns void language sql security definer as $$insert into public.trial_documents(organization_id,amount) values(p_org,50)$$;
 grant select,insert,update,delete on organizations,organization_members,trial_documents,trial_lines to authenticated;
 alter table organizations enable row level security;create policy org_read on organizations for select to authenticated using(owner_user_id=auth.uid() or exists(select 1 from organization_members where organization_id=organizations.id and user_id=auth.uid()));create policy org_insert on organizations for insert to authenticated with check(owner_user_id=auth.uid());
 set yaqeen.platform_owner_ddl_approval='APPROVED_PLATFORM_OWNER_SCHEMA';`);
  await db.exec(
    await load(
      "docs/production-owner-review/20261028185536_platform_owner_production_review.sql",
    ),
  );
  await db.exec(
    `insert into platform_admins(user_id,role) values('${owner}','platform_owner')`,
  );
  await db.exec(
    await load(
      "supabase/migrations/20261030150759_organization_trial_entitlements.sql",
    ),
  );
  await identity();
  let org;
  await check(
    "existing organizations retain access and have no automatically created subscription",
    async () => {
      const { rows } = await db.query(
        "select public.organization_subscription($1) value",
        [legacy],
      );
      assert.equal(rows[0].value.status, "legacy");
      assert.equal(rows[0].value.can_write, true);
      await db.query(
        "insert into trial_documents(organization_id,amount) values($1,1)",
        [legacy],
      );
      await admin();
      assert.equal(
        (await db.query("select count(*) n from platform_subscriptions"))
          .rows[0].n,
        0,
      );
      await identity();
    },
  );
  await check(
    "new organization creates owner and exactly 30 UTC days in one transaction",
    async () => {
      org = (
        await db.query(
          "insert into organizations(owner_user_id,name) values($1,'New institution') returning id",
          [owner],
        )
      ).rows[0].id;
      const e = (
        await db.query("select organization_subscription($1) value", [org])
      ).rows[0].value;
      assert.equal(e.status, "trialing");
      assert.equal(e.active_users, 1);
      assert.equal(e.max_users, 5);
      assert.equal(
        new Date(e.trial_ends_at) - new Date(e.trial_started_at),
        30 * 86400000,
      );
      assert.equal(e.days_remaining, 30);
    },
  );
  await check(
    "client cannot select legacy mode, backdate a new organization or restart via account changes",
    async () => {
      const r = (
        await db.query(
          "insert into organizations(owner_user_id,name,subscription_mode,created_at) values($1,'Forced legacy','legacy','2000-01-01') returning id,subscription_mode,created_at",
          [owner],
        )
      ).rows[0];
      assert.equal(r.subscription_mode, "managed");
      assert.ok(new Date(r.created_at) > new Date("2026-01-01"));
      await admin();
      await denied(
        "update organizations set subscription_mode='legacy' where id=$1",
        [org],
        /SUBSCRIPTION_MODE_IMMUTABLE/,
      );
      await identity();
    },
  );
  await check(
    "four more members allowed; sixth blocked, inactive members do not consume seats",
    async () => {
      await admin();
      for (let i = 3; i <= 7; i++) {
        const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
        await db.query(
          "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
          [id, `user${i}@trial.local`],
        );
        await db.query("insert into profiles(id) values($1)", [id]);
        if (i <= 6)
          await db.query(
            "insert into organization_members(organization_id,user_id,role) values($1,$2,'VIEWER')",
            [org, id],
          );
      }
      await denied(
        "insert into organization_members(organization_id,user_id,role) values($1,'00000000-0000-4000-8000-000000000007','VIEWER')",
        [org],
        /SUBSCRIPTION_USER_LIMIT/,
      );
      await db.query(
        "insert into organization_members(organization_id,user_id,role,status) values($1,'00000000-0000-4000-8000-000000000007','VIEWER','INACTIVE')",
        [org],
      );
      await denied(
        "update organization_members set status='ACTIVE' where organization_id=$1 and user_id='00000000-0000-4000-8000-000000000007'",
        [org],
        /SUBSCRIPTION_USER_LIMIT/,
      );
      await identity();
    },
  );
  await check(
    "pending invitations consume no seats and never reset trial",
    async () => {
      await admin();
      const before = (
        await db.query(
          "select trial_ends_at from platform_subscriptions where organization_id=$1",
          [org],
        )
      ).rows[0].trial_ends_at;
      await db.query(
        "insert into organization_invitations(organization_id,email,token) values($1,'pending@trial.local','test-pending')",
        [org],
      );
      assert.equal(
        (
          await db.query(
            "select count(*) n from organization_members where organization_id=$1 and status='ACTIVE'",
            [org],
          )
        ).rows[0].n,
        5,
      );
      assert.equal(
        String(
          (
            await db.query(
              "select trial_ends_at from platform_subscriptions where organization_id=$1",
              [org],
            )
          ).rows[0].trial_ends_at,
        ),
        String(before),
      );
      await identity();
    },
  );
  let document;
  await check("writes and RLS isolation work before expiry", async () => {
    document = (
      await db.query(
        "insert into trial_documents(organization_id,amount) values($1,12) returning id",
        [org],
      )
    ).rows[0].id;
    await identity(user, "44444444-4444-4444-8444-444444444444");
    assert.equal(
      (
        await db.query(
          "select * from trial_documents where organization_id=$1",
          [org],
        )
      ).rows.length,
      0,
    );
    await denied(
      "select organization_subscription($1)",
      [org],
      /ORGANIZATION_ACCESS_REQUIRED/,
    );
    await identity();
  });
  await check(
    "expiry immediately denies direct, indirect and SECURITY DEFINER writes without a scheduler",
    async () => {
      await admin();
      await db.query(
        "update platform_subscriptions set trial_started_at=now()-interval '31 days',trial_ends_at=now()-interval '1 day' where organization_id=$1",
        [org],
      );
      await identity();
      assert.equal(
        (await db.query("select organization_subscription($1) value", [org]))
          .rows[0].value.status,
        "expired",
      );
      await denied(
        "insert into trial_documents(organization_id,amount) values($1,3)",
        [org],
      );
      await denied("update trial_documents set amount=99 where id=$1", [
        document,
      ]);
      await denied("delete from trial_documents where id=$1", [document]);
      await denied("insert into trial_lines(document_id,amount) values($1,9)", [
        document,
      ]);
      await denied("select trial_post($1)", [org]);
      await denied(
        "update trial_documents set organization_id=$1 where id=$2",
        [legacy, document],
      );
    },
  );
  await check(
    "legacy name-linked budget rows and their new persistent organization identity cannot bypass expiry",
    async () => {
      await admin();
      await denied(
        "insert into budget_plans(user_id,organization_name,amount) values($1,$2,3)",
        [owner, "New institution"],
      );
      await identity();
    },
  );
  await check(
    "read/export remain available with unchanged data after expiry",
    async () => {
      const rows = (
        await db.query(
          "select amount from trial_documents where organization_id=$1",
          [org],
        )
      ).rows;
      assert.equal(rows.length, 1);
      assert.equal(Number(rows[0].amount), 12);
      await admin();
      await db.exec(
        "copy (select * from trial_documents) to stdout with csv header",
      );
      await identity();
    },
  );
  await check(
    "normal user and anonymous caller cannot administer subscriptions or invoke private helpers",
    async () => {
      await identity(user, "44444444-4444-4444-8444-444444444444");
      await denied(
        "select owner_manage_trial('extend','not authorized',$1,1,7)",
        [org],
        /PLATFORM_OWNER_REQUIRED/,
      );
      await denied(
        "select subscription_private.assert_writable($1)",
        [org],
        /permission denied/,
      );
      await denied(
        "update platform_subscriptions set status='active' where organization_id=$1",
        [org],
        /permission denied/,
      );
      await db.exec("reset role;set role anon");
      await denied(
        "select organization_subscription($1)",
        [org],
        /permission denied/,
      );
      await identity();
    },
  );
  await check(
    "owner extension restores writes, audits old/new values and rejects stale retries",
    async () => {
      await db.query(
        "select owner_manage_trial('extend','Customer requested more evaluation time',$1,1,7)",
        [org],
      );
      assert.equal(
        (await db.query("select organization_subscription($1) value", [org]))
          .rows[0].value.status,
        "trialing",
      );
      await db.query(
        "insert into trial_documents(organization_id,amount) values($1,13)",
        [org],
      );
      await denied(
        "select owner_manage_trial('extend','Duplicate request',$1,1,7)",
        [org],
        /SUBSCRIPTION_CONFLICT/,
      );
      const audit = (
        await db.query("select owner_trial_audit($1) value", [org])
      ).rows[0].value;
      assert.equal(audit.length, 1);
      assert.equal(audit[0].actor_user_id, owner);
      assert.equal(audit[0].details.before.revision, 1);
      assert.equal(audit[0].details.after.revision, 2);
    },
  );
  await check(
    "default change only affects future organizations; DST and browser clock cannot shorten duration",
    async () => {
      const e = (
        await db.query("select organization_subscription($1) value", [org])
      ).rows[0].value;
      await db.query(
        "select owner_manage_trial('defaults','New customer trial duration',null,1,45)",
      );
      await admin();
      await db.exec("set timezone='America/New_York'");
      await identity();
      const second = (
        await db.query(
          "insert into organizations(owner_user_id,name) values($1,'New default') returning id",
          [owner],
        )
      ).rows[0].id;
      const x = (
        await db.query("select organization_subscription($1) value", [second])
      ).rows[0].value;
      assert.equal(
        new Date(x.trial_ends_at) - new Date(x.trial_started_at),
        45 * 86400000,
      );
      assert.equal(
        new Date(
          (
            await db.query("select organization_subscription($1) value", [org])
          ).rows[0].value.trial_ends_at,
        ).getTime(),
        new Date(e.trial_ends_at).getTime(),
      );
      await admin();
      await db.exec("set timezone='UTC'");
      await identity();
    },
  );
  await check(
    "notifications and repeated sweeps are idempotent; extended schedule has a new revision",
    async () => {
      await admin();
      await db.query(
        "update platform_subscriptions set trial_ends_at=now()+interval '20 hours' where organization_id=$1",
        [org],
      );
      await identity();
      await db.query("select organization_subscription($1)", [org]);
      await db.query("select organization_subscription($1)", [org]);
      await admin();
      await db.query("select subscription_private.sweep_trials()");
      await db.query("select subscription_private.sweep_trials()");
      assert.equal(
        (
          await db.query(
            "select count(*) n from subscription_private.notifications n join platform_subscriptions s on s.id=n.subscription_id where s.organization_id=$1 and n.revision=2",
            [org],
          )
        ).rows[0].n,
        3,
      );
      await identity();
    },
  );
  await check(
    "manual activation, suspension and paid expiration enforce access without charging",
    async () => {
      await admin();
      await identity();
      const plan = (
        await db.query(
          "select owner_create_subscription_plan('manual_test','خطة اختبار','Test plan',99,'USD','yearly','Approved plan setup') id",
        )
      ).rows[0].id;
      await db.query(
        "select owner_manage_trial('activate','Offline subscription approved',$1,2,null,now()+interval '1 year',$2,5)",
        [org, plan],
      );
      assert.equal(
        (await db.query("select organization_subscription($1) value", [org]))
          .rows[0].value.status,
        "active",
      );
      await admin();
      await db.query(
        "update platform_subscriptions set started_at=now()-interval '2 days',current_period_end=now()-interval '1 second' where organization_id=$1",
        [org],
      );
      await identity();
      assert.equal(
        (await db.query("select organization_subscription($1) value", [org]))
          .rows[0].value.status,
        "expired",
      );
      await denied("select trial_post($1)", [org]);
      await db.query(
        "select owner_manage_trial('activate','Paid renewal approved',$1,3,null,now()+interval '1 year',$2,5)",
        [org, plan],
      );
      await db.query(
        "select owner_manage_trial('suspend','Administrative review required',$1,4)",
        [org],
      );
      await denied("select trial_post($1)", [org]);
      await db.query(
        "select owner_manage_trial('resume','Review completed successfully',$1,5)",
        [org],
      );
      await db.query("select trial_post($1)", [org]);
      await admin();
      assert.equal(
        (await db.query("select count(*) n from platform_payment_transactions"))
          .rows[0].n,
        0,
      );
      await identity();
    },
  );
  await check(
    "existing legacy organization changes only after explicit owner manual activation",
    async () => {
      const plan = (
        await db.query(
          "select owner_create_subscription_plan('legacy_paid','خطة مؤسسات','Institution plan',150,'SAR','monthly','Approved legacy plan setup') id",
        )
      ).rows[0].id;
      await db.query(
        "select owner_manage_trial('activate','Explicit owner legacy activation',$1,0,null,now()+interval '1 month',$2,10)",
        [legacy, plan],
      );
      const e = (
        await db.query("select organization_subscription($1) value", [legacy])
      ).rows[0].value;
      assert.equal(e.status, "active");
      assert.equal(e.trial_started_at, null);
      assert.equal(e.revision, 1);
    },
  );
  await check(
    "owner session revocation immediately denies administrative access",
    async () => {
      await admin();
      await db.query("delete from auth.sessions where id=$1", [session]);
      await identity();
      await denied(
        "select owner_trial_register() ",
        [],
        /PLATFORM_OWNER_REQUIRED/,
      );
    },
  );
  console.log(
    JSON.stringify({ passed: report.length, checks: report }, null, 2),
  );
  await writeFile(
    new URL("tests/subscriptions/database-result.json", root),
    JSON.stringify(
      {
        engine: "PGlite PostgreSQL",
        scope:
          "synthetic compatibility fixture; not a full production schema audit",
        passed: report.length,
        checks: report,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await db.close();
}
