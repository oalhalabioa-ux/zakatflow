-- Assets V2 ownership and classification foundation (QA first)
-- Preserves legacy personal/zakat behavior. Existing rows remain PERSONAL.
create table if not exists public.asset_classes (
 code text primary key,
 name_en text not null,
 name_ar text not null,
 financial_classification_type text not null check (financial_classification_type in ('ASSET','CAPEX','INVESTMENT','RECEIVABLE')),
 active boolean not null default true,
 created_at timestamptz not null default now()
);

create table if not exists public.asset_types_v2 (
 code text primary key,
 class_code text not null references public.asset_classes(code),
 name_en text not null,
 name_ar text not null,
 default_legacy_asset_type text,
 active boolean not null default true,
 created_at timestamptz not null default now()
);

insert into public.asset_classes(code,name_en,name_ar,financial_classification_type) values
 ('PPE','Property, Plant & Equipment','الممتلكات والآلات والمعدات','CAPEX'),
 ('INVESTMENT','Investment Assets','الأصول الاستثمارية','INVESTMENT'),
 ('FINANCIAL','Financial Assets','الأصول المالية','ASSET'),
 ('INVENTORY','Inventory','المخزون','ASSET'),
 ('INTANGIBLE','Intangible Assets','الأصول غير الملموسة','CAPEX'),
 ('OTHER','Other Assets','أصول أخرى','ASSET')
on conflict (code) do nothing;

insert into public.asset_types_v2(code,class_code,name_en,name_ar,default_legacy_asset_type) values
 ('LAND','PPE','Land','أراضٍ','REAL_ESTATE'),('BUILDING','PPE','Building','مبانٍ','REAL_ESTATE'),
 ('VEHICLE','PPE','Vehicle','مركبات','OTHER'),('MACHINERY','PPE','Machinery','آلات ومعدات','OTHER'),
 ('FURNITURE','PPE','Furniture','أثاث','OTHER'),('IT_EQUIPMENT','PPE','IT Equipment','معدات تقنية','OTHER'),
 ('INVESTMENT_PROPERTY','INVESTMENT','Investment Property','عقار استثماري','REAL_ESTATE'),
 ('EQUITY_INVESTMENT','INVESTMENT','Equity Investment','استثمار في أسهم','STOCK'),
 ('FUND','INVESTMENT','Investment Fund','صندوق استثماري','STOCK'),
 ('SUKUK_BOND','INVESTMENT','Sukuk / Bond','صكوك وسندات','OTHER'),
 ('CASH','FINANCIAL','Cash','نقد','CASH'),('BANK','FINANCIAL','Bank Account','حساب بنكي','BANK'),
 ('RECEIVABLE','FINANCIAL','Receivable','ذمم مدينة','RECEIVABLE'),('DEPOSIT','FINANCIAL','Deposit','وديعة','OTHER'),
 ('RAW_MATERIAL','INVENTORY','Raw Materials','مواد خام','INVENTORY'),
 ('FINISHED_GOODS','INVENTORY','Finished Goods','بضاعة تامة','INVENTORY'),
 ('TRADING_INVENTORY','INVENTORY','Trading Inventory','مخزون تجاري','INVENTORY'),
 ('SOFTWARE','INTANGIBLE','Software','برمجيات','OTHER'),('LICENSE','INTANGIBLE','License','تراخيص','OTHER'),
 ('TRADEMARK','INTANGIBLE','Trademark','علامات تجارية','OTHER'),('GOODWILL','INTANGIBLE','Goodwill','شهرة تجارية','OTHER'),
 ('PREPAYMENT','OTHER','Prepayment','مصروفات مقدمة','OTHER'),('ADVANCE','OTHER','Advance','دفعات مقدمة','OTHER'),
 ('OTHER_ASSET','OTHER','Other Asset','أصل آخر','OTHER')
on conflict (code) do nothing;

alter table public.asset_accounts add column if not exists ownership_scope text not null default 'PERSONAL';
alter table public.asset_accounts add column if not exists organization_id uuid references public.organizations(id);
alter table public.asset_accounts add column if not exists entity_id uuid references public.organization_entities(id);
alter table public.asset_accounts add column if not exists cost_center_id uuid references public.organization_cost_centers(id);
alter table public.asset_accounts add column if not exists asset_class_code text references public.asset_classes(code);
alter table public.asset_accounts add column if not exists asset_type_code text references public.asset_types_v2(code);

do $$ begin
 if not exists(select 1 from pg_constraint where conname='asset_accounts_ownership_scope_check') then
  alter table public.asset_accounts add constraint asset_accounts_ownership_scope_check
   check (ownership_scope in ('PERSONAL','ORGANIZATION'));
 end if;
 if not exists(select 1 from pg_constraint where conname='asset_accounts_owner_consistency_check') then
  alter table public.asset_accounts add constraint asset_accounts_owner_consistency_check
   check ((ownership_scope='PERSONAL' and organization_id is null and entity_id is null and cost_center_id is null)
       or (ownership_scope='ORGANIZATION' and organization_id is not null));
 end if;
end $$;

create index if not exists idx_asset_accounts_organization on public.asset_accounts(organization_id) where ownership_scope='ORGANIZATION';
create index if not exists idx_asset_accounts_class_type on public.asset_accounts(asset_class_code,asset_type_code);

comment on column public.asset_accounts.user_id is 'Legacy creator/personal owner. For ORGANIZATION assets ownership is organization_id; retained for compatibility and audit.';
comment on column public.asset_accounts.ownership_scope is 'PERSONAL preserves legacy ZakatFlow behavior; ORGANIZATION enables enterprise asset ownership.';
