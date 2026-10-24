-- Customer records are reachable only by the server and project owners.
begin;
create schema clinic_private;
revoke all on schema clinic_private from public, anon, authenticated;
grant usage on schema clinic_private to service_role;

create table public.appointment_requests (
  id uuid primary key default gen_random_uuid(),
  submission_key uuid not null unique,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  appointment_type text not null check (appointment_type in ('Genel randevu', 'Kontrol randevusu')),
  full_name text not null check (char_length(full_name) between 2 and 100),
  phone text not null check (phone ~ '^\+?[0-9]{10,15}$'),
  pet_name text not null default '' check (char_length(pet_name) <= 80),
  species text not null check (species in ('Kedi', 'Köpek', 'Kuş', 'Kemirgen', 'Diğer egzotik')),
  preferred_date date,
  service text not null check (service in ('Muayene', 'Aşı', 'Cerrahi / kısırlaştırma', 'Laboratuvar', 'Beslenme danışmanlığı', 'Konaklama (hayvan oteli)', 'Acil durum', 'Diğer / emin değilim')),
  notes text not null default '' check (char_length(notes) <= 1500),
  reminder_requested boolean not null default false,
  reminder_requested_at timestamptz,
  reminder_text_version text not null default '2026-10-24-v1',
  status text not null default 'new' check (status in ('new', 'contacted', 'confirmed', 'cancelled', 'completed')),
  internal_note text not null default '' check (char_length(internal_note) <= 2000),
  constraint reminder_timestamp_matches_preference check (
    (reminder_requested and reminder_requested_at is not null)
    or (not reminder_requested and reminder_requested_at is null)
  )
);
create index appointment_requests_newest on public.appointment_requests (created_at desc);
alter table public.appointment_requests enable row level security;
revoke all on public.appointment_requests from public, anon, authenticated;
grant select, insert, update on public.appointment_requests to service_role;

create table clinic_private.appointment_rate_limits (
  bucket_key text primary key check (bucket_key ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null default now(),
  hits integer not null default 1 check (hits > 0)
);
alter table clinic_private.appointment_rate_limits enable row level security;
revoke all on clinic_private.appointment_rate_limits from public, anon, authenticated;
grant select, insert, update on clinic_private.appointment_rate_limits to service_role;

create function public.consume_appointment_rate_limit(p_key text)
returns boolean language plpgsql security invoker set search_path = ''
as $$
declare current_hits integer;
begin
  insert into clinic_private.appointment_rate_limits as limits (bucket_key)
  values (p_key)
  on conflict (bucket_key) do update set
    hits = case when limits.window_started_at < now() - interval '15 minutes' then 1 else limits.hits + 1 end,
    window_started_at = case when limits.window_started_at < now() - interval '15 minutes' then now() else limits.window_started_at end
  returning hits into current_hits;
  return current_hits <= 5;
end;
$$;
revoke all on function public.consume_appointment_rate_limit(text) from public, anon, authenticated;
grant execute on function public.consume_appointment_rate_limit(text) to service_role;

create function public.submit_appointment_request(p_request jsonb, p_payload_hash text, p_rate_keys text[])
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare existing public.appointment_requests%rowtype; receipt uuid; rate_key text;
begin
  select * into existing from public.appointment_requests
    where submission_key = (p_request ->> 'submissionKey')::uuid;
  if found then
    if existing.payload_hash <> p_payload_hash then
      raise exception 'SUBMISSION_CONFLICT' using errcode = '22023';
    end if;
    return jsonb_build_object('id', existing.id, 'duplicate', true);
  end if;
  if cardinality(p_rate_keys) not between 1 and 2 then
    raise exception 'INVALID_RATE_KEYS' using errcode = '22023';
  end if;
  foreach rate_key in array p_rate_keys loop
    if not public.consume_appointment_rate_limit(rate_key) then
      raise exception 'RATE_LIMITED' using errcode = 'P0001';
    end if;
  end loop;
  insert into public.appointment_requests (
    submission_key, payload_hash, appointment_type, full_name, phone, pet_name,
    species, preferred_date, service, notes, reminder_requested, reminder_requested_at
  ) values (
    (p_request ->> 'submissionKey')::uuid, p_payload_hash, p_request ->> 'appointment',
    p_request ->> 'name', p_request ->> 'phone', p_request ->> 'pet',
    p_request ->> 'species', nullif(p_request ->> 'date', '')::date,
    p_request ->> 'service', p_request ->> 'notes', (p_request ->> 'reminder')::boolean,
    case when (p_request ->> 'reminder')::boolean then now() else null end
  ) on conflict (submission_key) do nothing returning id into receipt;
  if receipt is null then
    select * into existing from public.appointment_requests
      where submission_key = (p_request ->> 'submissionKey')::uuid;
    if existing.payload_hash <> p_payload_hash then
      raise exception 'SUBMISSION_CONFLICT' using errcode = '22023';
    end if;
    receipt := existing.id;
  end if;
  return jsonb_build_object('id', receipt, 'duplicate', false);
end;
$$;
revoke all on function public.submit_appointment_request(jsonb, text, text[]) from public, anon, authenticated;
grant execute on function public.submit_appointment_request(jsonb, text, text[]) to service_role;
comment on table public.appointment_requests is 'Private clinic appointment requests. A request is not a confirmed appointment.';
commit;
