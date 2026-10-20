-- Ficha del profesional (equipo.html): lista de personas que le dieron acceso, con sus permisos.
-- Ejecutar en Supabase > SQL Editor. Idempotente. Requiere 20261008_care_links.sql.
-- Solo nombre y permisos: ningún dato de salud, por eso no registra acceso. Los datos de cada sección se leen con
-- patient_lesiones / patient_examenes / patient_nutricion, que sí registran el acceso y vuelven a validar el permiso.

create or replace function public.my_linked_patients() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_prof uuid := public.current_professional_id();
begin
  if v_prof is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('patient_id', pt.id, 'patient_name', pt.name, 'scopes', l.scopes, 'granted_at', l.granted_at) order by pt.name)
    from public.care_links l join public.patients pt on pt.id = l.patient_id
    where l.professional_id = v_prof and l.revoked_at is null), '[]'::jsonb);
end $$;
revoke all on function public.my_linked_patients() from public, anon;
grant execute on function public.my_linked_patients() to authenticated;
