-- Run in the project's SQL Editor. All test records roll back.
begin;
set local role service_role;
do $$
declare
  request jsonb := jsonb_build_object(
    'submissionKey', gen_random_uuid()::text, 'appointment', 'Kontrol randevusu',
    'name', 'TEST - transactional check', 'phone', '05000000000', 'pet', 'TEST',
    'species', 'Kedi', 'date', '', 'service', 'Muayene', 'notes', 'TEST', 'reminder', true
  );
  first_receipt jsonb; second_receipt jsonb; counter integer;
begin
  first_receipt := public.submit_appointment_request(request, repeat('a', 64), array[repeat('b', 64)]);
  second_receipt := public.submit_appointment_request(request, repeat('a', 64), array[repeat('b', 64)]);
  if first_receipt ->> 'id' <> second_receipt ->> 'id' then
    raise exception 'Idempotency failed';
  end if;
  if (select count(*) from public.appointment_requests where submission_key = (request ->> 'submissionKey')::uuid) <> 1 then
    raise exception 'Duplicate record created';
  end if;
  if not exists (select 1 from public.appointment_requests where id = (first_receipt ->> 'id')::uuid and reminder_requested and reminder_requested_at is not null and status = 'new') then
    raise exception 'Preference or initial status missing';
  end if;
  begin
    perform public.submit_appointment_request(request, repeat('c', 64), array[repeat('b', 64)]);
    raise exception 'Conflicting request accepted' using errcode = 'XX000';
  exception when invalid_parameter_value then
    if sqlerrm <> 'SUBMISSION_CONFLICT' then raise; end if;
  end;
  for counter in 1..5 loop
    request := jsonb_set(request, '{submissionKey}', to_jsonb(gen_random_uuid()::text));
    perform public.submit_appointment_request(request, repeat('a', 64), array[repeat('d', 64)]);
  end loop;
  begin
    request := jsonb_set(request, '{submissionKey}', to_jsonb(gen_random_uuid()::text));
    perform public.submit_appointment_request(request, repeat('a', 64), array[repeat('d', 64)]);
    raise exception 'Rate limit missing' using errcode = 'XX000';
  exception when raise_exception then
    if sqlerrm <> 'RATE_LIMITED' then raise; end if;
  end;
end;
$$;
reset role;
do $$
begin
  if has_table_privilege('anon', 'public.appointment_requests', 'SELECT')
    or has_table_privilege('anon', 'public.appointment_requests', 'INSERT')
    or has_table_privilege('authenticated', 'public.appointment_requests', 'SELECT')
    or has_function_privilege('anon', 'public.submit_appointment_request(jsonb,text,text[])', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.submit_appointment_request(jsonb,text,text[])', 'EXECUTE')
    or has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE') then
    raise exception 'Private records are exposed';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.appointment_requests'::regclass) then
    raise exception 'RLS is disabled';
  end if;
end;
$$;
select 'PASS: idempotency, consent, rate limit, RLS and permissions' as verification;
rollback;
