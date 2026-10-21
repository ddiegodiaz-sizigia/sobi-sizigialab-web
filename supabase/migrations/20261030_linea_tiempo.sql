-- Línea de tiempo de la hoja de vida para el profesional (fase 3 del rediseño, portada de la ficha).
-- Idempotente. Se aplica a mano en Supabase > SQL Editor.
-- journal_entries no tiene política para profesionales (solo la persona y el admin la leen por RLS): esta función es
-- la única puerta. Devuelve solo las entradas cuyos temas (scope) el profesional tiene autorizados hoy en su vínculo
-- activo, con el nombre y rol de quien las escribió, y deja una fila en access_log por cada tema que expone.
-- 'bitacora' = entradas generales; salud_mental y ciclo solo con su permiso explícito (regla 4 del proyecto).

create or replace function public.patient_timeline(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prof uuid := public.current_professional_id();
  v_scopes text[];
begin
  if v_prof is null then raise exception 'sin permiso'; end if;
  select array_agg(distinct s order by s) into v_scopes
    from public.care_links l, unnest(l.scopes) s
   where l.professional_id = v_prof and l.patient_id = p_patient and l.revoked_at is null
     and s in ('bitacora','lesiones','nutricion','examenes','salud_mental','ciclo');
  if v_scopes is null then raise exception 'sin permiso linea de tiempo'; end if;
  insert into public.access_log (professional_id, patient_id, scope) select v_prof, p_patient, s from unnest(v_scopes) s;
  return jsonb_build_object(
    'scopes', to_jsonb(v_scopes),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('id', j.id, 'entry_date', j.entry_date, 'kind', j.kind, 'title', j.title, 'body', j.body, 'scope', j.scope,
               'author_kind', j.author_kind, 'author_name', pr.name, 'author_role', pr.role, 'created_at', j.created_at)
             order by j.entry_date desc, j.created_at desc)
        from public.journal_entries j
        left join public.professionals pr on pr.id = j.author_professional_id
       where j.patient_id = p_patient and j.scope = any (v_scopes) and j.entry_date >= current_date - 730), '[]'::jsonb));
end $$;

revoke all on function public.patient_timeline(uuid) from public, anon;
grant execute on function public.patient_timeline(uuid) to authenticated;
