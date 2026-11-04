-- Individual readers (no teams) and a simpler choice board of activities.
drop function public.teacher_team_add(text, text);
drop function public.teacher_team_delete(text, uuid);
drop function public.teacher_student_move(text, uuid, uuid);
drop function public.teacher_student_add(text, text, uuid);
drop function public.teacher_add_reading(text, uuid, text, boolean, boolean);
drop function app.board(uuid);
alter table app.student drop column team_id;
drop table app.team;
alter table app.submission drop column teammate, drop column pages;
alter table app.submission drop constraint submission_proof_check;
alter table app.submission add constraint submission_proof_check check (proof in ('bme','facts','words','draw','write','achieve','teacher'));

create or replace function app.student_points(p uuid) returns int language sql stable set search_path = '' as $$
  select coalesce(sum(10 + case when spot_passed then 3 else 0 end), 0)::int
  from app.submission where student_id = p and status = 'approved'
$$;

create or replace function app.check_work(p jsonb) returns void language plpgsql immutable set search_path = '' as $$
declare proof text := p ->> 'proof'; c jsonb := coalesce(p -> 'content', '{}'::jsonb); words int;
begin
  if length(btrim(coalesce(p ->> 'title', ''))) not between 1 and 120 then raise exception 'title'; end if;
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
    'open', (select jsonb_build_object('id', r.id, 'elapsed', floor(extract(epoch from now() - r.started_at))::int)
             from app.reading r where r.student_id = s.id and r.submitted_at is null),
    'work', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title, 'proof', w.proof, 'status', w.status,
              'spot_passed', w.spot_passed, 'created_at', w.created_at) order by w.created_at desc)
             from app.submission w where w.student_id = s.id), '[]'::jsonb),
    'class_readings', (select count(*) from app.submission w join app.student x on x.id = w.student_id
             where x.class_id = s.class_id and w.status = 'approved'),
    'classmates', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.first_name, 'points', app.student_points(x.id),
              'stars', (select count(*) from app.submission w where w.student_id = x.id and w.status = 'approved')) order by x.first_name)
             from app.student x where x.class_id = s.class_id), '[]'::jsonb));
end $$;

create or replace function public.submission_create(p_token text, p_reading uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s app.student := app.student_from(p_token); r app.reading; new_id uuid;
begin
  select * into r from app.reading where id = p_reading and student_id = s.id and submitted_at is null;
  if not found then raise exception 'no_reading'; end if;
  if now() - r.started_at < interval '895 seconds' then raise exception 'too_soon'; end if;
  perform app.check_work(p);
  update app.reading set submitted_at = now() where id = r.id;
  insert into app.submission (student_id, reading_id, title, proof, content, drawing, score, jfk)
    values (s.id, r.id, btrim(p ->> 'title'), p ->> 'proof', coalesce(p -> 'content', '{}'::jsonb),
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
  update app.submission set title = btrim(p ->> 'title'), proof = p ->> 'proof',
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
        'readings', (select count(*) from app.submission w where w.student_id = s.id and w.status = 'approved'),
        'jfk', (select count(*) from app.submission w where w.student_id = s.id and w.status = 'approved' and w.jfk)) order by s.first_name)
      from app.student s where s.class_id = cid), '[]'::jsonb),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'student_id', w.student_id, 'title', w.title,
        'proof', w.proof, 'score', w.score, 'jfk', w.jfk, 'status', w.status, 'spot_passed', w.spot_passed,
        'created_at', w.created_at) order by w.created_at desc)
      from app.submission w join app.student s on s.id = w.student_id where s.class_id = cid), '[]'::jsonb));
end $$;

create function public.teacher_add_reading(p_token text, p_student uuid, p_title text, p_jfk boolean) returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token);
begin
  if not exists (select 1 from app.student where id = p_student and class_id = cid) then raise exception 'not_found'; end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'title'; end if;
  insert into app.submission (student_id, title, proof, jfk, status)
    values (p_student, btrim(p_title), 'teacher', coalesce(p_jfk, false), 'approved');
end $$;

create function public.teacher_student_add(p_token text, p_name text) returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token);
begin
  if length(btrim(coalesce(p_name, ''))) not between 1 and 30 then raise exception 'invalid'; end if;
  insert into app.student (class_id, first_name, pin)
    values (cid, btrim(p_name), lpad(floor(random() * 10000)::int::text, 4, '0'));
end $$;

revoke all on all functions in schema public from public, authenticated;
grant execute on all functions in schema public to anon;
