const { PGlite } = require('@electric-sql/pglite');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '../..');
const read = path => readFileSync(join(root, path), 'utf8');
const id = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');

async function main() {
  const db = new PGlite();
  try {
    const owner = id(1), method = id(2);
    const gold = id(3), cash = id(4), home = id(5);
    const source = id(6), sourceTransaction = id(7);
    await db.exec(`
      create schema auth;
      create schema private;
      create table auth.users(id uuid primary key);
      create role anon;
      create role authenticated;
    `);
    await db.exec(read('supabase/migrations/20260915195428_001_schema.sql')
      .split('create table if not exists audit_logs')[0].replace('create extension if not exists pgcrypto;', ''));
    await db.exec(read('supabase/migrations/20261010192246_cumulative_hawl_periods_and_allocation_repair.sql')
      .split('create or replace function public.zakat_lot_hawl_periods')[0]);
    await db.exec(`
      alter table transactions add organization_id uuid;
      alter table asset_accounts add organization_id uuid, add ownership_scope text default 'PERSONAL';
      alter table lots add organization_id uuid, add hawl_continuity_source_lot_id uuid;
      alter table lots alter hawl_start_date drop not null, alter hawl_due_date drop not null;
      alter table zakat_assessments add organization_id uuid;
      alter table zakat_assessment_lines add valuation_snapshot jsonb;
      create table zakat_hawl_cycles(user_id uuid, final_assessment_id uuid);
      create table voucher_numbers(source_table text, source_id uuid, owner_id uuid,
        organization_id uuid, document_number text);
      create table private.personal_gold_receipt_hawl_sources(
        receipt_id uuid, receipt_lot_id uuid, source_lot_id uuid, user_id uuid, source_order integer,
        sold_quantity numeric, source_hawl_start_date date, continuity_applies boolean,
        source_covered_through date, coverage_captured boolean
      );
      create table private.gold_receipt_assessment_components(
        assessment_line_id uuid, source_lot_id uuid, period_due date, eligible_base numeric
      );
      insert into auth.users values ('${owner}');
      insert into currencies(code,name_ar,name_en) values ('SAR','SAR','SAR');
      insert into zakat_methods(id,code,name_en,name_ar,calendar_type)
        values ('${method}','QA','QA','QA','GREGORIAN');
      insert into profiles(id,base_currency,zakat_method_id) values ('${owner}','SAR','${method}');
      insert into asset_accounts(id,user_id,asset_type,name,currency,is_zakatable) values
        ('${gold}','${owner}','GOLD','Gold','SAR',true),
        ('${cash}','${owner}','CASH','Cash','SAR',true),
        ('${home}','${owner}','REAL_ESTATE','Home','SAR',false);
      insert into transactions(id,user_id,asset_account_id,transaction_type,transaction_date,currency,base_currency)
        values ('${sourceTransaction}','${owner}','${gold}','PURCHASE',current_date-1100,'SAR','SAR');
      insert into lots(id,user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,
        original_quantity,remaining_quantity,original_value_base,remaining_value_base)
        values ('${source}','${owner}','${gold}','${sourceTransaction}',current_date-1100,current_date-1100,3,0,90,0);
    `);

    const legacy = id(12), unknown = id(22), multiple = id(32), reversed = id(42);
    for (const [sale, receipt, lot, remaining] of [
      [id(10), id(11), legacy, 100], [id(20), id(21), unknown, 100],
      [id(30), id(31), multiple, 60], [id(40), id(41), reversed, 0],
    ]) {
      await db.query(`
        with sale as (
          insert into transactions(id,user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value)
          values($1,$2,$3,'SALE',current_date-7,1,'SAR','SAR',100)
          returning id
        ), receipt as (
          insert into transactions(id,user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value,metadata)
          select $4,$2,$5,'ADD',current_date-7,100,'SAR','SAR',100,
            jsonb_build_object('source','sale_proceeds','sale_transaction_id',sale.id)
          from sale returning id
        )
        insert into lots(id,user_id,asset_account_id,source_transaction_id,acquisition_date,
          original_quantity,remaining_quantity,original_value_base,remaining_value_base)
        select $6,$2,$5,receipt.id,current_date-7,100,$7,100,$7 from receipt
      `, [sale, owner, gold, receipt, cash, lot, remaining]);
    }
    const overdue = id(50), excluded = id(51), covered = id(52);
    await db.exec(`
      insert into transactions(id,user_id,asset_account_id,transaction_type,transaction_date,currency,base_currency,reversal_of_transaction_id)
        values ('${id(43)}','${owner}','${cash}','REVERSAL',current_date,'SAR','SAR','${id(41)}');
      insert into private.personal_gold_receipt_hawl_sources values
        ('${id(21)}','${unknown}','${source}','${owner}',1,1,null,true,null,false),
        ('${id(31)}','${multiple}','${source}','${owner}',1,1,current_date-1100,true,null,true);
      insert into transactions(id,user_id,asset_account_id,transaction_type,transaction_date,currency,base_currency) values
        ('${id(53)}','${owner}','${cash}','ADD',current_date-400,'SAR','SAR'),
        ('${id(54)}','${owner}','${home}','PURCHASE',current_date-1100,'SAR','SAR'),
        ('${id(55)}','${owner}','${cash}','ADD',current_date-400,'SAR','SAR');
      insert into lots(id,user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,
        original_quantity,remaining_quantity,original_value_base,remaining_value_base) values
        ('${overdue}','${owner}','${cash}','${id(53)}',current_date-400,current_date-400,20,20,20,20),
        ('${excluded}','${owner}','${home}','${id(54)}',current_date-1100,current_date-1100,1,1,1200,1200),
        ('${covered}','${owner}','${cash}','${id(55)}',current_date-400,current_date-400,40,40,40,40);
      insert into zakat_assessments(id,user_id,assessment_date,valuation_date,method_id,nisab_standard,
        nisab_quantity,nisab_value_base,total_zakatable_value,zakat_rate,zakat_due,currency,status)
        values ('${id(60)}','${owner}',current_date-25,current_date-25,'${method}','GOLD',85,10,40,0.025,1,'SAR','CALCULATED');
      insert into zakat_assessment_lines(id,assessment_id,lot_id,quantity,market_value,eligible_value,zakat_amount,eligibility_status,explanation)
        values ('${id(61)}','${id(60)}','${covered}',40,40,40,1,'ELIGIBLE','Synthetic final coverage');
      insert into zakat_hawl_cycles values ('${owner}','${id(60)}');
    `);

    const checksum = () => db.query(`
      select md5((select jsonb_agg(l order by l.id) from lots l)::text ||
                 (select jsonb_agg(a order by a.id) from zakat_assessments a)::text) as digest
    `).then(result => result.rows[0].digest);
    const before = await checksum();
    const results = await db.exec(read('scripts/audit-asset-hawl-exceptions.sql'));
    const rows = results.find(result => result.fields.some(field => field.name === 'review_lot_id')).rows;
    const byLot = new Map(rows.map(row => [row.review_lot_id, row.reasons]));
    assert.deepEqual(byLot, new Map([
      [overdue, ['PAST_UNCOVERED_PERIOD']],
      [legacy, ['LEGACY_RECEIPT_NO_HAWL_EVIDENCE']],
      [unknown, ['RECEIPT_SOURCE_HAWL_UNKNOWN']],
      [multiple, ['MULTIPLE_UNASSESSED_HAWLS_REQUIRE_REVIEW']],
    ]));
    assert.equal(rows.find(row => row.review_lot_id === legacy).first_due_date, null);
    assert.equal(await checksum(), before);
    console.log('Passed legacy receipt, missing source Hawl, overdue periods, reversal, final coverage and non-Zakatable asset checks.');
  } finally {
    await db.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
