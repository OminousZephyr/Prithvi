-- Stage 11: owner-scoped metadata replication. Apply manually in the Supabase SQL editor.
create table if not exists public.prithvi_sync_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  local_user_id text not null,
  record_type text not null check (record_type in (
    'farm', 'field', 'crop', 'crop-observation', 'scouting-evidence', 'scouting-zone',
    'scouting-task', 'advisory', 'alert', 'flight-session'
  )),
  local_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, record_type, local_id)
);

create index if not exists prithvi_sync_records_owner_updated
  on public.prithvi_sync_records (owner_id, updated_at);

alter table public.prithvi_sync_records enable row level security;
grant select, insert, update, delete on public.prithvi_sync_records to authenticated;

drop policy if exists "users read own PRITHVI records" on public.prithvi_sync_records;
create policy "users read own PRITHVI records" on public.prithvi_sync_records
  for select using (auth.uid() = owner_id);

drop policy if exists "users insert own PRITHVI records" on public.prithvi_sync_records;
create policy "users insert own PRITHVI records" on public.prithvi_sync_records
  for insert with check (auth.uid() = owner_id);

drop policy if exists "users update own PRITHVI records" on public.prithvi_sync_records;
create policy "users update own PRITHVI records" on public.prithvi_sync_records
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "users delete own PRITHVI records" on public.prithvi_sync_records;
create policy "users delete own PRITHVI records" on public.prithvi_sync_records
  for delete using (auth.uid() = owner_id);

comment on table public.prithvi_sync_records is
  'Owner-scoped PRITHVI metadata replication. record_type is restricted to the version-1 Farm, Field, Crop, CropObservation, ScoutingEvidence, ScoutingZone, ScoutingTask, Advisory, Alert, and FlightSession contract. Images and high-frequency telemetry are excluded.';
