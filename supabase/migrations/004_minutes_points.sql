-- Students report their reading minutes instead of using a timer. 1 point per minute, 10 per activity.
drop function public.reading_start(text);
drop function public.reading_cancel(text);
drop function public.submission_create(text, uuid, jsonb);
drop function public.teacher_add_reading(text, uuid, text, boolean);
alter table app.submission drop column reading_id;
drop table app.reading;
alter table app.submission add column minutes int not null default 15 check (minutes between 1 and 180);
alter table app.submission alter column minutes drop default;

create or replace function app.student_points(p uuid) returns int language sql stable set search_path = '' as $$
  select coalesce(sum(minutes + 10 + case when spot_passed then 3 else 0 end + case when proof = 'achieve' and score > 75 then 3 else 0 end), 0)::int
  from app.submission where student_id = p and status = 'approved'
$$;

create or replace function app.check_work(p jsonb) returns void language plpgsql immutable set search_path = '' as $$
declare proof text := p ->> 'proof'; c jsonb := coalesce(p -> 'content', '{}'::jsonb); words int;
begin
  if length(btrim(coalesce(p ->> 'title', ''))) not between 1 and 120 then raise exception 'title'; end if;
  if coalesce(p ->> 'minutes', '') !~ '^[0-9]{1,3}$' or (p ->> 'minutes')::int not between 5 and 60 then raise exception 'minutes'; end if;
  if proof = 'bme' then
    if not app.filled(c, array['beginning','middle','end']) then raise exception 'incomplete'; end if;
  elsif proof = 'facts' then
    if not app.filled(c, array['f1','f2','f3']) then raise exception 'incomplete'; end if;
  elsif proof = 'words' then
    if not app.filled(c, array['w1','m1','w2','m2']) then raise exception 'incomplete'; end if;
  elsif proof = 'draw' then
    if not app.filled(c, array['caption']) then raise exception 'incomplete'; end if;
    if length(coalesce(p ->> 'drawing', '')) > 1500000
       or coalesce(p ->> 'drawing', '') !~ '^data:image/(jpeg|png);base64,[A-Za-z0-9+/=]+$' then raise exception 'drawing'; end if;
  elsif proof = 'write' then
    if not app.filled(c, array['text']) then raise exception 'incomplete'; end if;
    words := coalesce(array_length(regexp_split_to_array(btrim(c ->> 'text'), '\s+'), 1), 0);
    if words < 15 then raise exception 'too_short'; end if;
  elsif proof = 'achieve' then
    if not app.filled(c, array['learned']) then raise exception 'incomplete'; end if;
    if coalesce(p ->> 'score', '') !~ '^[0-9]{1,3}$' or (p ->> 'score')::int > 100 then raise exception 'score'; end if;
    if (p ->> 'score')::int < 75 then raise exception 'score_low'; end if;
  else
    raise exception 'invalid';
  end if;
end $$;

create or replace function public.student_home(p_token text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s app.student := app.student_from(p_token);
begin
  return jsonb_build_object(
    'me', jsonb_build_object('id', s.id, 'name', s.first_name),
    'class_name', (select name from app.class where id = s.class_id),
    'points', app.student_points(s.id),
    'stars', (select count(*) from app.submission where student_id = s.id and status = 'approved'),
    'minutes', (select coalesce(sum(minutes), 0) from app.submission where student_id = s.id and status = 'approved'),
    'work', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title, 'proof', w.proof, 'score', w.score, 'minutes', w.minutes, 'status', w.status,
              'spot_passed', w.spot_passed, 'created_at', w.created_at) order by w.created_at desc)
             from app.submission w where w.student_id = s.id), '[]'::jsonb),
    'class_minutes', (select coalesce(sum(w.minutes), 0) from app.submission w join app.student x on x.id = w.student_id
             where x.class_id = s.class_id and w.status = 'approved'),
    'classmates', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.first_name, 'points', app.student_points(x.id),
              'stars', (select count(*) from app.submission w where w.student_id = x.id and w.status = 'approved')) order by x.first_name)
             from app.student x where x.class_id = s.class_id), '[]'::jsonb));
end $$;

create function public.submission_create(p_token text, p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s app.student := app.student_from(p_token); new_id uuid;
begin
  perform app.check_work(p);
  insert into app.submission (student_id, title, minutes, proof, content, drawing, score, jfk)
    values (s.id, btrim(p ->> 'title'), (p ->> 'minutes')::int, p ->> 'proof', coalesce(p -> 'content', '{}'::jsonb),
      case when p ->> 'proof' = 'draw' then p ->> 'drawing' end,
      case when p ->> 'proof' = 'achieve' then (p ->> 'score')::int end,
      coalesce((p ->> 'jfk')::boolean, false))
    returning id into new_id;
  return jsonb_build_object('id', new_id);
end $$;

create or replace function public.submission_resubmit(p_token text, p_id uuid, p jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare s app.student := app.student_from(p_token);
begin
  perform app.check_work(p);
  update app.submission set title = btrim(p ->> 'title'), minutes = (p ->> 'minutes')::int, proof = p ->> 'proof',
      content = coalesce(p -> 'content', '{}'::jsonb),
      drawing = case when p ->> 'proof' = 'draw' then p ->> 'drawing' end,
      score = case when p ->> 'proof' = 'achieve' then (p ->> 'score')::int end,
      jfk = coalesce((p ->> 'jfk')::boolean, false),
      status = 'pending', updated_at = now()
    where id = p_id and student_id = s.id and status = 'retry';
  if not found then raise exception 'not_found'; end if;
end $$;

create or replace function public.teacher_state(p_token text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token);
begin
  return jsonb_build_object(
    'class', (select jsonb_build_object('name', name, 'code', code) from app.class where id = cid),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.first_name, 'pin', s.pin,
        'points', app.student_points(s.id),
        'minutes', (select coalesce(sum(w.minutes), 0) from app.submission w where w.student_id = s.id and w.status = 'approved'),
        'readings', (select count(*) from app.submission w where w.student_id = s.id and w.status = 'approved'),
        'jfk', (select count(*) from app.submission w where w.student_id = s.id and w.status = 'approved' and w.jfk)) order by s.first_name)
      from app.student s where s.class_id = cid), '[]'::jsonb),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'student_id', w.student_id, 'title', w.title, 'minutes', w.minutes,
        'proof', w.proof, 'score', w.score, 'jfk', w.jfk, 'status', w.status, 'spot_passed', w.spot_passed,
        'created_at', w.created_at) order by w.created_at desc)
      from app.submission w join app.student s on s.id = w.student_id where s.class_id = cid), '[]'::jsonb));
end $$;

create function public.teacher_add_reading(p_token text, p_student uuid, p_title text, p_minutes int, p_jfk boolean) returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token);
begin
  if not exists (select 1 from app.student where id = p_student and class_id = cid) then raise exception 'not_found'; end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'title'; end if;
  if coalesce(p_minutes, 0) not between 1 and 180 then raise exception 'minutes_teacher'; end if;
  insert into app.submission (student_id, title, minutes, proof, jfk, status)
    values (p_student, btrim(p_title), p_minutes, 'teacher', coalesce(p_jfk, false), 'approved');
end $$;

create function public.teacher_set_minutes(p_token text, p_id uuid, p_minutes int) returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token);
begin
  if coalesce(p_minutes, 0) not between 1 and 180 then raise exception 'minutes_teacher'; end if;
  update app.submission w set minutes = p_minutes, updated_at = now()
    from app.student s where s.id = w.student_id and w.id = p_id and s.class_id = cid;
  if not found then raise exception 'not_found'; end if;
end $$;

revoke all on all functions in schema public from public, authenticated;
grant execute on all functions in schema public to anon;
