-- Teachers sign in with email and password. New teachers join with a school code; an admin can issue password reset codes.
alter table app.teacher add column email text unique, add column is_admin boolean not null default false;
alter table app.teacher add constraint teacher_email_lower check (email = lower(email));

create table app.settings (
  id boolean primary key default true check (id),
  join_code text not null
);
alter table app.settings enable row level security;

create function app.new_code(n int) returns text language plpgsql volatile set search_path = '' as $$
declare a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; c text := '';
begin
  for i in 1..n loop c := c || substr(a, 1 + floor(random() * length(a))::int, 1); end loop;
  return c;
end $$;
insert into app.settings (join_code) values (app.new_code(8));

drop function public.teacher_setup(text, text, text);
drop function public.teacher_login(text, text);

create function app.teacher_session_for(t uuid, c uuid) returns jsonb language plpgsql volatile set search_path = '' as $$
declare tok text := app.new_token();
begin
  delete from app.teacher_session where expires_at < now();
  insert into app.teacher_session (token_hash, class_id, teacher_id, expires_at) values (app.hash_token(tok), c, t, now() + interval '14 days');
  return jsonb_build_object('token', tok);
end $$;

create function public.teacher_login(p_email text, p_password text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare t app.teacher; c uuid;
begin
  select * into t from app.teacher where email = lower(btrim(p_email));
  if not found then return jsonb_build_object('error', 'bad_login'); end if;
  if t.locked_until > now() then raise exception 'locked'; end if;
  if t.pw_hash is null or extensions.crypt(p_password, t.pw_hash) <> t.pw_hash then
    update app.teacher set failed = case when failed >= 4 then 0 else failed + 1 end,
      locked_until = case when failed >= 4 then now() + interval '15 minutes' else null end where id = t.id;
    return jsonb_build_object('error', 'bad_login');
  end if;
  update app.teacher set failed = 0, locked_until = null where id = t.id;
  select id into c from app.class where teacher_id = t.id order by created_at limit 1;
  return app.teacher_session_for(t.id, c);
end $$;

create function public.teacher_signup(p_email text, p_password text, p_school_code text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare e text := lower(btrim(coalesce(p_email, ''))); t uuid; c uuid;
begin
  if upper(btrim(coalesce(p_school_code, ''))) <> (select join_code from app.settings) then return jsonb_build_object('error', 'bad_school_code'); end if;
  if e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(e) > 200 then raise exception 'bad_email'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'short_password'; end if;
  if exists (select 1 from app.teacher where email = e) then raise exception 'email_taken'; end if;
  insert into app.teacher (email, pw_hash) values (e, extensions.crypt(p_password, extensions.gen_salt('bf', 10))) returning id into t;
  insert into app.class (code, teacher_id) values (app.new_class_code(), t) returning id into c;
  return app.teacher_session_for(t, c);
end $$;

create function public.teacher_reset_password(p_email text, p_reset_code text, p_password text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare t app.teacher; c uuid;
begin
  select * into t from app.teacher where email = lower(btrim(p_email));
  if not found then return jsonb_build_object('error', 'bad_login'); end if;
  if t.locked_until > now() then raise exception 'locked'; end if;
  if t.setup_code_hash is null or extensions.crypt(upper(btrim(p_reset_code)), t.setup_code_hash) <> t.setup_code_hash then
    update app.teacher set failed = case when failed >= 4 then 0 else failed + 1 end,
      locked_until = case when failed >= 4 then now() + interval '15 minutes' else null end where id = t.id;
    return jsonb_build_object('error', 'bad_login');
  end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'short_password'; end if;
  update app.teacher set pw_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    setup_code_hash = null, failed = 0, locked_until = null where id = t.id;
  delete from app.teacher_session where teacher_id = t.id;
  select id into c from app.class where teacher_id = t.id order by created_at limit 1;
  return app.teacher_session_for(t.id, c);
end $$;

create or replace function public.teacher_state(p_token text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token); tid uuid := app.teacher_from(p_token); admin boolean;
begin
  select is_admin into admin from app.teacher where id = tid;
  return jsonb_build_object(
    'me', (select jsonb_build_object('email', email, 'is_admin', is_admin) from app.teacher where id = tid),
    'admin', case when admin then jsonb_build_object(
      'school_code', (select join_code from app.settings),
      'teachers', (select jsonb_agg(jsonb_build_object('id', t.id, 'email', t.email,
          'classes', (select count(*) from app.class c where c.teacher_id = t.id),
          'students', (select count(*) from app.student s join app.class c on c.id = s.class_id where c.teacher_id = t.id)) order by t.email)
        from app.teacher t)) end,
    'class', (select jsonb_build_object('id', id, 'name', name, 'code', code) from app.class where id = cid),
    'classes', (select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'code', c.code,
        'students', (select count(*) from app.student s where s.class_id = c.id),
        'pending', (select count(*) from app.submission w join app.student s on s.id = w.student_id where s.class_id = c.id and w.status = 'pending')) order by c.created_at)
      from app.class c where c.teacher_id = tid),
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

-- Admin only: a one-time code a teacher can use to choose a new password.
create function public.teacher_issue_reset_code(p_token text, p_teacher uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare tid uuid := app.teacher_from(p_token); code text := app.new_code(8);
begin
  if not (select is_admin from app.teacher where id = tid) then raise exception 'not_found'; end if;
  update app.teacher set setup_code_hash = extensions.crypt(code, extensions.gen_salt('bf', 10)), failed = 0, locked_until = null where id = p_teacher;
  if not found then raise exception 'not_found'; end if;
  return jsonb_build_object('code', code);
end $$;

revoke all on all functions in schema public from public, authenticated;
grant execute on all functions in schema public to anon;
