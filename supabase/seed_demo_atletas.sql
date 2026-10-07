-- DATOS 100 % SINTÉTICOS para demo y video. No usar pacientes reales.
-- Requiere haber corrido 20261007_athlete_logs.sql. Ejecutar en Supabase > SQL Editor.
-- Crea 3 atletas ficticios con 8 semanas de registros: uno en verde, uno en amarillo y uno en rojo.
-- Los emails terminan en .invalid: nadie puede entrar con ellos; se ven solo desde el panel admin.
-- Para limpiar: delete from public.patients where email like '%@demo.sizigialab.invalid';

do $$
declare
  defs text[][] := array[
    ['Atleta Demo Verde (sintético)',    'verde@demo.sizigialab.invalid',    'verde'],
    ['Atleta Demo Amarillo (sintético)', 'amarillo@demo.sizigialab.invalid', 'amarillo'],
    ['Atleta Demo Rojo (sintético)',     'rojo@demo.sizigialab.invalid',     'rojo']
  ];
  i int; g int; pid uuid; scenario text; r1 numeric; r2 numeric; r3 numeric;
  d date; trained boolean; sh numeric; fat int; pain int; zone text; rpe int; mins int; sq int; md int;
begin
  for i in 1..3 loop
    scenario := defs[i][3];
    delete from public.patients where email = defs[i][2];
    insert into public.patients (name, email, phone, start_date, program_months)
      values (defs[i][1], defs[i][2], '', current_date - 56, 3)
      returning id into pid;

    for g in 0..55 loop              -- g = días hacia atrás
      d  := current_date - g;
      r1 := abs(sin(g * 12.9898 + i * 78.233));
      r2 := abs(sin(g * 39.346  + i * 11.135));
      r3 := abs(sin(g * 25.123  + i * 53.987));
      trained := extract(dow from d) <> 0 and r1 > 0.25;
      sh   := round((7.2 + (r2 - 0.5))::numeric, 1);
      sq   := 6 + round(r3 * 2);
      fat  := 3 + round(r1 * 2);
      md   := 6 + round(r2 * 2);
      pain := case when r3 > 0.9 then 1 else 0 end;
      zone := null;
      rpe  := 5 + round(r2 * 2);
      mins := 60 + round(r1 * 20);

      if scenario = 'amarillo' and g <= 2 then
        sh := 5.8; sq := 4; fat := 7 + (g % 2); md := 5;
      elsif scenario = 'rojo' and g <= 6 then
        rpe := 8; mins := 100; trained := true;      -- semana de carga alta
        if g <= 2 then sh := 5.6; sq := 4; fat := 8; md := 4; pain := 6; zone := 'Rodilla derecha'; end if;
      end if;

      insert into public.athlete_logs
        (patient_id, log_date, sleep_hours, sleep_quality, fatigue, mood, pain_level, pain_zone, trained, session_rpe, session_minutes, notes)
      values
        (pid, d, sh, sq, fat, md, pain, zone, trained, case when trained then rpe end, case when trained then mins end,
         case when scenario = 'rojo' and g = 0 then 'Molestia al bajar escaleras (dato sintético)' end);
    end loop;
  end loop;
end $$;
