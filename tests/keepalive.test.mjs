import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../supabase/migrations/20261110_keepalive.sql', import.meta.url), 'utf8');
const wf = readFileSync(new URL('../.github/workflows/supabase-keepalive.yml', import.meta.url), 'utf8');

// Migración idempotente, con RLS y sin acceso directo a la tabla
assert.match(sql, /create table if not exists public\.keep_alive/);
assert.match(sql, /check \(id = 1\)/, 'una sola fila');
assert.match(sql, /alter table public\.keep_alive enable row level security/);
assert.ok(!/create policy/.test(sql), 'sin políticas: solo vía la función');
assert.match(sql, /revoke all on public\.keep_alive from anon, authenticated/);

// La función escribe (no solo lee) y es lo único expuesto
assert.match(sql, /create or replace function public\.keepalive_ping\(\)/);
assert.match(sql, /security definer\s+set search_path = public/);
assert.match(sql, /on conflict \(id\) do update/);
assert.match(sql, /revoke all on function public\.keepalive_ping\(\) from public/);
assert.match(sql, /grant execute on function public\.keepalive_ping\(\) to anon, authenticated/);

// El workflow llama al RPC (POST) al menos cada 6 horas
assert.match(wf, /rest\/v1\/rpc\/keepalive_ping/);
assert.match(wf, /-X POST/);
assert.match(wf, /cron: "\d+ \*\/6 \* \* \*"/);
console.log('keepalive ok');
