-- La persona fija su propio sexo y su seguimiento de ciclo. Requiere 20261020 y current_patient_id().
create or replace function public.set_my_profile(p_sex text, p_tracks_cycle boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_patient uuid := public.current_patient_id();
begin
  if v_patient is null then raise exception 'no es paciente'; end if;
  if p_sex is not null and p_sex not in ('femenino','masculino','no_indica') then raise exception 'sexo invalido'; end if;
  update public.patients set sex = coalesce(p_sex, sex), tracks_cycle = coalesce(p_tracks_cycle, tracks_cycle) or coalesce(p_sex, sex) = 'femenino'
    where id = v_patient;
end $$;
revoke all on function public.set_my_profile(text, boolean) from public, anon;
grant execute on function public.set_my_profile(text, boolean) to authenticated;
