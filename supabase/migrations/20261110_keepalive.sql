-- Keep-alive: el plan Free pausa el proyecto si no hay actividad real en la base durante 7 días.
-- Un GET con la clave pública cada 2 días no bastó (pausa 3-nov-2026). Este RPC escribe una fila
-- (una sola, id = 1) y lo llama el workflow .github/workflows/supabase-keepalive.yml cada 6 horas.
-- Idempotente. RLS activo y sin políticas: nadie lee ni escribe la tabla directo; solo vía la función.

create table if not exists public.keep_alive (
  id smallint primary key default 1 check (id = 1),
  pinged_at timestamptz not null default now(),
  pings bigint not null default 0
);
alter table public.keep_alive enable row level security;
revoke all on public.keep_alive from anon, authenticated;

create or replace function public.keepalive_ping()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  insert into public.keep_alive (id, pinged_at, pings) values (1, now(), 1)
  on conflict (id) do update set pinged_at = now(), pings = public.keep_alive.pings + 1
  returning pinged_at;
$$;

revoke all on function public.keepalive_ping() from public;
grant execute on function public.keepalive_ping() to anon, authenticated;
