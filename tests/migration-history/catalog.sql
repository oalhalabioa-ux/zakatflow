with relations as (
 select c.oid,c.relname,n.nspname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','private','subscription_private') and c.relkind='r'
), objects as (
 select 'column' category,r.nspname||'.'||r.relname||'.'||a.attname object_key,
 jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid))::text value
 from relations r join pg_attribute a on a.attrelid=r.oid left join pg_attrdef d on d.adrelid=r.oid and d.adnum=a.attnum where a.attnum>0 and not a.attisdropped
 union all select 'constraint',r.nspname||'.'||r.relname||'.'||c.conname,pg_get_constraintdef(c.oid,true) from relations r join pg_constraint c on c.conrelid=r.oid
 union all select 'index',schemaname||'.'||tablename||'.'||indexname,indexdef from pg_indexes where schemaname in ('public','private','subscription_private')
 union all select 'trigger',r.nspname||'.'||r.relname||'.'||t.tgname,pg_get_triggerdef(t.oid,true) from relations r join pg_trigger t on t.tgrelid=r.oid where not t.tgisinternal
 union all select 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',pg_get_functiondef(p.oid)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','subscription_private') and p.prokind='f'
 and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
 union all select 'policy',schemaname||'.'||tablename||'.'||policyname,to_jsonb(p)::text from pg_policies p where schemaname in ('public','private','subscription_private')
 union all select 'rls',r.nspname||'.'||r.relname,r.relrowsecurity::text from relations r
) select category,object_key,md5(value) fingerprint from objects order by category,object_key;