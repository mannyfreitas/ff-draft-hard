create table public.draft_claims (
  player_id text primary key,
  claimed_by uuid not null references auth.users(id) on delete cascade,
  roster_index integer,
  claim_type text not null check (claim_type in ('drafted', 'unavailable')),
  created_at timestamptz not null default now()
);

alter table public.draft_claims enable row level security;

create policy "Authenticated users can read shared draft claims"
  on public.draft_claims
  for select
  to authenticated
  using (true);

create policy "Users can create their own draft claims"
  on public.draft_claims
  for insert
  to authenticated
  with check (auth.uid() = claimed_by);

create policy "Users can remove their own draft claims"
  on public.draft_claims
  for delete
  to authenticated
  using (auth.uid() = claimed_by);

grant select, insert, delete on public.draft_claims to authenticated;

alter publication supabase_realtime add table public.draft_claims;
