-- The Worker is the authorization boundary. Browser anon/authenticated roles have
-- no table or RPC access. The server secret is kept in Cloudflare Secrets.
create table if not exists public.classroom_state (
  id text primary key,
  revision bigint not null default 1 check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.classroom_state enable row level security;
revoke all on table public.classroom_state from public, anon, authenticated;
grant select, insert, update, delete on table public.classroom_state to service_role;

-- SECURITY INVOKER: this function does not elevate caller privileges.
-- The row lock makes an entire classroom mutation atomic, including answer
-- deduplication, the buzz winner, and the daily AI call reservation.
create or replace function public.classroom_compare_and_swap(
  p_id text,
  p_expected bigint,
  p_payload jsonb
) returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_revision bigint;
begin
  if length(p_id) > 100 or p_expected < 0 or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid classroom snapshot';
  end if;
  if octet_length(p_payload::text) > 25000000 then
    raise exception 'Classroom snapshot exceeds 25 MB; archive old sessions';
  end if;
  if p_expected = 0 then
    insert into public.classroom_state (id, revision, payload)
      values (p_id, 1, p_payload)
      on conflict (id) do nothing
      returning revision into v_revision;
    return coalesce(v_revision, 0);
  end if;
  update public.classroom_state
     set payload = p_payload, revision = revision + 1, updated_at = now()
   where id = p_id and revision = p_expected
   returning revision into v_revision;
  return coalesce(v_revision, 0);
end;
$$;
revoke all on function public.classroom_compare_and_swap(text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.classroom_compare_and_swap(text,bigint,jsonb) to service_role;

comment on table public.classroom_state is 'Small deployment snapshot. Worker enforces teacher ownership and student class/seat scope. Do not expose directly to browser clients.';
