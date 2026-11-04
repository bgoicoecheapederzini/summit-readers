-- One teacher account can own several classes. A teacher session remembers which class is open.
create table app.teacher (
  id uuid primary key default gen_random_uuid(),
  pw_hash text,
  setup_code_hash text,
  failed int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
alter table app.teacher enable row level security;
insert into app.teacher (id, pw_hash, setup_code_hash, failed, locked_until, created_at)
  select id, teacher_pw_hash, setup_code_hash, failed, locked_until, created_at from app.class;
alter table app.class add column teacher_id uuid references app.teacher on delete cascade;
update app.class set teacher_id = id;
alter table app.class alter column teacher_id set not null;
create index on app.class (teacher_id);
alter table app.class drop column teacher_pw_hash, drop column setup_code_hash, drop column failed, drop column locked_until;
alter table app.teacher_session add column teacher_id uuid references app.teacher on delete cascade;
update app.teacher_session s set teacher_id = c.teacher_id from app.class c where c.id = s.class_id;
alter table app.teacher_session alter column teacher_id set not null;
create index on app.teacher_session (teacher_id);

create function app.teacher_from(p_token text) returns uuid language plpgsql stable set search_path = '' as $$
declare t uuid;
begin
  select teacher_id into t from app.teacher_session where token_hash = app.hash_token(p_token) and expires_at > now();
  if not found then raise exception 'auth'; end if;
  return t;
end $$;

create function app.new_class_code() returns text language plpgsql volatile set search_path = '' as $$
declare a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; c text;
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(a, 1 + floor(random() * length(a))::int, 1); end loop;
    exit when not exists (select 1 from app.class where code = c);
  end loop;
  return c;
end $$;

create or replace function public.teacher_setup(p_code text, p_setup text, p_password text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c app.class; t app.teacher; tok text;
begin
  select * into c from app.class where code = upper(btrim(p_code));
  if not found then raise exception 'bad_login'; end if;
  select * into t from app.teacher where id = c.teacher_id;
  if t.locked_until > now() then raise exception 'locked'; end if;
  if t.setup_code_hash is null or extensions.crypt(p_setup, t.setup_code_hash) <> t.setup_code_hash then
    update app.teacher set failed = case when failed >= 4 then 0 else failed + 1 end,
      locked_until = case when failed >= 4 then now() + interval '15 minutes' else null end where id = t.id;
    return jsonb_build_object('error', 'bad_login');
  end if;
  if length(p_password) < 8 then raise exception 'short_password'; end if;
  update app.teacher set pw_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    setup_code_hash = null, failed = 0, locked_until = null where id = t.id;
  tok := app.new_token();
  insert into app.teacher_session (token_hash, class_id, teacher_id, expires_at) values (app.hash_token(tok), c.id, t.id, now() + interval '14 days');
  return jsonb_build_object('token', tok);
end $$;

create or replace function public.teacher_login(p_code text, p_password text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c app.class; t app.teacher; tok text;
begin
  select * into c from app.class where code = upper(btrim(p_code));
  if not found then return jsonb_build_object('error', 'bad_login'); end if;
  select * into t from app.teacher where id = c.teacher_id;
  if t.locked_until > now() then raise exception 'locked'; end if;
  if t.pw_hash is null or extensions.crypt(p_password, t.pw_hash) <> t.pw_hash then
    update app.teacher set failed = case when failed >= 4 then 0 else failed + 1 end,
      locked_until = case when failed >= 4 then now() + interval '15 minutes' else null end where id = t.id;
    return jsonb_build_object('error', 'bad_login');
  end if;
  update app.teacher set failed = 0, locked_until = null where id = t.id;
  delete from app.teacher_session where expires_at < now();
  tok := app.new_token();
  insert into app.teacher_session (token_hash, class_id, teacher_id, expires_at) values (app.hash_token(tok), c.id, t.id, now() + interval '14 days');
  return jsonb_build_object('token', tok);
end $$;

create or replace function public.teacher_state(p_token text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token); tid uuid := app.teacher_from(p_token);
begin
  return jsonb_build_object(
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

create function public.teacher_class_add(p_token text, p_name text) returns void language plpgsql security definer set search_path = '' as $$
declare tid uuid := app.teacher_from(p_token); new_id uuid;
begin
  if length(btrim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'invalid'; end if;
  insert into app.class (code, name, teacher_id) values (app.new_class_code(), btrim(p_name), tid) returning id into new_id;
  update app.teacher_session set class_id = new_id where token_hash = app.hash_token(p_token);
end $$;

create function public.teacher_class_switch(p_token text, p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare tid uuid := app.teacher_from(p_token);
begin
  if not exists (select 1 from app.class where id = p_id and teacher_id = tid) then raise exception 'not_found'; end if;
  update app.teacher_session set class_id = p_id where token_hash = app.hash_token(p_token);
end $$;

-- Only an empty class that isn't open can be removed, so no student's work can be lost by accident.
create function public.teacher_class_delete(p_token text, p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare tid uuid := app.teacher_from(p_token); cid uuid := app.class_from(p_token);
begin
  if not exists (select 1 from app.class where id = p_id and teacher_id = tid) then raise exception 'not_found'; end if;
  if p_id = cid then raise exception 'class_open'; end if;
  if exists (select 1 from app.student where class_id = p_id) then raise exception 'class_not_empty'; end if;
  delete from app.class where id = p_id and teacher_id = tid;
end $$;

revoke all on all functions in schema public from public, authenticated;
grant execute on all functions in schema public to anon;
