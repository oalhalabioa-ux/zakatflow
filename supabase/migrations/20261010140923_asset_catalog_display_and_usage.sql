-- Additive only: no updates to asset accounts, lots, transactions or assessments.
insert into public.asset_classes(code,name_en,name_ar,financial_classification_type)
values ('METALS','Precious metals','المعادن الثمينة','ASSET') on conflict(code) do nothing;
insert into public.asset_types_v2(code,class_code,name_en,name_ar,default_legacy_asset_type) values
 ('GOLD','METALS','Gold','ذهب','GOLD'),('SILVER','METALS','Silver','فضة','SILVER'),
 ('INVESTMENT_LAND','INVESTMENT','Investment land','أرض استثمارية','REAL_ESTATE'),
 ('DEVELOPMENT_PROPERTY','INVESTMENT','Property under development','عقار قيد التطوير للاستثمار','REAL_ESTATE'),
 ('BOND','INVESTMENT','Bond','سندات','OTHER'),
 ('WORK_IN_PROGRESS','INVENTORY','Work in progress','إنتاج تحت التشغيل','INVENTORY'),
 ('LOAN_RECEIVABLE','FINANCIAL','Loan receivable','قروض ممنوحة','RECEIVABLE'),
 ('OTHER_RECEIVABLE','FINANCIAL','Other receivable','مستحقات أخرى','RECEIVABLE'),
 ('REFUNDABLE_DEPOSIT','OTHER','Refundable deposit','تأمينات مستردة','OTHER')
on conflict(code) do nothing;
alter table public.user_settings add column if not exists asset_usage_mode text not null default 'BOTH'
 check(asset_usage_mode in ('PERSONAL','ORGANIZATION','BOTH'));
