-- Add a pasted list of readers in one step. Names already in the class are skipped.
drop function public.teacher_student_add(text, text);

create function public.teacher_students_add(p_token text, p_names text[]) returns jsonb language plpgsql security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token); n text; clean text; added int := 0; skipped int := 0;
begin
  if coalesce(array_length(p_names, 1), 0) not between 1 and 60 then raise exception 'invalid'; end if;
  foreach n in array p_names loop
    clean := btrim(coalesce(n, ''));
    if length(clean) not between 1 and 30 then raise exception 'invalid'; end if;
    if exists (select 1 from app.student where class_id = cid and lower(first_name) = lower(clean)) then
      skipped := skipped + 1;
    else
      insert into app.student (class_id, first_name, pin) values (cid, clean, lpad(floor(random() * 10000)::int::text, 4, '0'));
      added := added + 1;
    end if;
  end loop;
  return jsonb_build_object('added', added, 'skipped', skipped);
end $$;

revoke all on all functions in schema public from public, authenticated;
grant execute on all functions in schema public to anon;
