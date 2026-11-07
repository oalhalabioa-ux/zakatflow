-- Read-only structural fingerprint inventory; never exports customer data, credentials or SQL function bodies.
-- Run separately against Production and Financial Core QA with a least-privilege read-only database identity.
WITH objects(category, object_key, fingerprint) AS (
 SELECT 'migration', version, md5('applied') FROM supabase_migrations.schema_migrations
 UNION ALL
 SELECT 'relation',n.nspname||'.'||c.relname,md5(concat_ws('|',c.relkind::text,c.relpersistence::text,
  c.relrowsecurity::text,c.relforcerowsecurity::text,coalesce(pg_get_viewdef(c.oid),'')))
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','private','subscription_private','private_budget_backups','qa_legacy')
   AND c.relkind IN ('r','p','v','m','f')
 UNION ALL
 SELECT 'column',table_schema||'.'||table_name||'.'||column_name,
  md5(concat_ws('|',data_type,udt_schema,udt_name,coalesce(character_maximum_length::text,''),
   coalesce(numeric_precision::text,''),coalesce(numeric_scale::text,''),is_nullable,
   coalesce(column_default,''),is_identity,is_generated))
 FROM information_schema.columns
 WHERE table_schema IN ('public','private','subscription_private','private_budget_backups','qa_legacy')
 UNION ALL
 SELECT 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
  md5(concat_ws('|',p.prokind,p.prosecdef::text,p.provolatile,p.proparallel,
    coalesce(array_to_string(p.proconfig,','),''),pg_get_functiondef(p.oid)))
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','private','subscription_private','qa_legacy')
 UNION ALL
 SELECT 'policy',schemaname||'.'||tablename||'.'||policyname,
  md5(concat_ws('|',permissive,roles::text,cmd,coalesce(qual,''),coalesce(with_check,'')))
 FROM pg_policies WHERE schemaname IN ('public','private','subscription_private','qa_legacy')
 UNION ALL
 SELECT 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,md5(pg_get_triggerdef(t.oid,true))
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE NOT t.tgisinternal AND n.nspname IN ('public','private','subscription_private','qa_legacy')
 UNION ALL
 SELECT 'constraint',n.nspname||'.'||c.relname||'.'||ct.conname,
  md5(concat_ws('|',ct.contype,pg_get_constraintdef(ct.oid,true)))
 FROM pg_constraint ct JOIN pg_class c ON c.oid=ct.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','private','subscription_private','qa_legacy')
 UNION ALL
 SELECT 'index',schemaname||'.'||tablename||'.'||indexname,md5(indexdef)
 FROM pg_indexes WHERE schemaname IN ('public','private','subscription_private','qa_legacy')
 UNION ALL
 SELECT 'table_grant',table_schema||'.'||table_name||'.'||grantee||'.'||privilege_type,md5(is_grantable)
 FROM information_schema.role_table_grants
 WHERE table_schema IN ('public','private','subscription_private','qa_legacy')
   AND grantee IN ('anon','authenticated','service_role','PUBLIC')
 UNION ALL
 SELECT 'enum',n.nspname||'.'||t.typname||'.'||e.enumlabel,md5(e.enumsortorder::text)
 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace
 WHERE n.nspname IN ('public','private','subscription_private','qa_legacy')
 UNION ALL
 SELECT 'extension',extname,md5(extversion) FROM pg_extension
)
SELECT jsonb_build_object('format','yaqeen-financial-schema-parity-v1',
 'serverVersion',current_setting('server_version'),
 'objects',coalesce(jsonb_agg(jsonb_build_object('category',category,'key',object_key,
  'fingerprint',fingerprint) ORDER BY category,object_key),'[]'::jsonb)
) AS inventory FROM objects;
