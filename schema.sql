-- Run once in the SQL editor of the app's Supabase project.
begin;
create table if not exists public.training_progress (
 user_id uuid primary key references auth.users(id) on delete cascade,
 state jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) < 4000000),
 revision bigint not null default 1 check(revision > 0),
 updated_at timestamptz not null default now()
);
alter table public.training_progress enable row level security;
revoke all on public.training_progress from anon;
grant select,insert,update on public.training_progress to authenticated;
drop policy if exists "Read own progress" on public.training_progress;
create policy "Read own progress" on public.training_progress for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Insert own progress" on public.training_progress;
create policy "Insert own progress" on public.training_progress for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Update own progress" on public.training_progress;
create policy "Update own progress" on public.training_progress for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Compare revisions in one transaction. Stale devices cannot overwrite newer logs.
create or replace function public.save_training_progress(p_state jsonb,p_expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare u uuid := auth.uid(); n bigint;
begin
 if u is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_expected_revision < 0 or p_expected_revision is null then raise exception 'Invalid revision'; end if;
 if p_expected_revision = 0 then
   insert into public.training_progress(user_id,state,revision) values(u,p_state,1) on conflict(user_id) do nothing returning revision into n;
 else
   update public.training_progress set state=p_state,revision=revision+1,updated_at=now() where user_id=u and revision=p_expected_revision returning revision into n;
 end if;
 if n is null then return jsonb_build_object('conflict',true); end if;
 return jsonb_build_object('conflict',false,'revision',n);
end;
$$;
revoke all on function public.save_training_progress(jsonb,bigint) from public,anon;
grant execute on function public.save_training_progress(jsonb,bigint) to authenticated;
commit;
