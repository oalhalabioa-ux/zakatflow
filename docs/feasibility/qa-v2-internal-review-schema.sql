
-- Historical QA-only evidence. Applied once to Yaqeen Financial Core QA V2 (ubotbpjngtfvolthpfec).
-- NEVER include in canonical Production history or apply to legacy Financial Core QA.
create table public.feasibility_review_snapshots (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.feasibility_projects(id) on delete restrict,
 owner_user_id uuid not null references auth.users(id),
 source_revision integer not null check (source_revision > 0),
 study_snapshot jsonb not null,
 review_kind text not null default 'INTERNAL_REVIEW' check (review_kind = 'INTERNAL_REVIEW'),
 notes text not null default '' check (length(notes) <= 2000),
 created_at timestamptz not null default now(),
 unique (project_id, source_revision)
);
comment on table public.feasibility_review_snapshots is 'QA V2 immutable INTERNAL review only. No legal approval, licensed financial statements or accounting postings.';
create index feasibility_reviews_owner_project_idx on public.feasibility_review_snapshots(owner_user_id, project_id, created_at desc);
create function private.capture_feasibility_review_snapshot()
returns trigger language plpgsql security invoker set search_path = ''
as $function$
declare p record;
begin
 if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED';end if;
 select id,owner_user_id,revision,study into p from public.feasibility_projects
  where id=new.project_id and owner_user_id=(select auth.uid()) for share;
 if not found then raise exception 'PROJECT_OWNER_REQUIRED';end if;
 if p.revision<>new.source_revision then raise exception 'STALE_STUDY_REVISION';end if;
 new.owner_user_id:=p.owner_user_id;
 new.study_snapshot:=p.study;
 new.review_kind:='INTERNAL_REVIEW';
 new.created_at:=now();
 return new;
end
$function$;
create trigger feasibility_review_capture_before_insert
before insert on public.feasibility_review_snapshots
for each row execute function private.capture_feasibility_review_snapshot();
alter table public.feasibility_review_snapshots enable row level security;
create policy feasibility_reviews_owner_select on public.feasibility_review_snapshots
for select to authenticated using (owner_user_id=(select auth.uid()));
create policy feasibility_reviews_owner_insert on public.feasibility_review_snapshots
for insert to authenticated with check (owner_user_id=(select auth.uid()));
revoke all on table public.feasibility_review_snapshots from public,anon,authenticated;
grant select on table public.feasibility_review_snapshots to authenticated;
grant insert (project_id, source_revision, notes) on table public.feasibility_review_snapshots to authenticated;
