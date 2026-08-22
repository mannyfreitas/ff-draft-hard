create table public.draft_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  drafted_ids jsonb not null default '[]'::jsonb,
  unavailable_ids jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.draft_states enable row level security;

create policy "Users can read their own draft state"
  on public.draft_states
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own draft state"
  on public.draft_states
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own draft state"
  on public.draft_states
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.draft_states to authenticated;
