-- Summit Readers. Tables live in the unexposed `app` schema; the site only calls the functions in `public`.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists app;
revoke all on schema app from public, anon, authenticated;

create table app.class (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default 'My Class',
  teacher_pw_hash text,
  setup_code_hash text,
  failed int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create table app.team (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references app.class on delete cascade,
  name text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index on app.team (class_id);
create table app.student (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references app.class on delete cascade,
  team_id uuid references app.team on delete set null,
  first_name text not null,
  pin text not null,
  failed int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create index on app.student (class_id);
create index on app.student (team_id);
create table app.student_session (
  token_hash bytea primary key,
  student_id uuid not null references app.student on delete cascade,
  expires_at timestamptz not null
);
create index on app.student_session (student_id);
create table app.teacher_session (
  token_hash bytea primary key,
  class_id uuid not null references app.class on delete cascade,
  expires_at timestamptz not null
);
create index on app.teacher_session (class_id);
create table app.reading (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app.student on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz
);
create unique index reading_one_open on app.reading (student_id) where submitted_at is null;
create table app.submission (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app.student on delete cascade,
  reading_id uuid unique references app.reading on delete set null,
  title text not null,
  pages text not null default '',
  proof text not null check (proof in ('map','idea','draw','write','achieve','teacher')),
  content jsonb not null default '{}',
  drawing text,
  score int,
  teammate boolean not null default false,
  jfk boolean not null default false,
  status text not null default 'pending' check (status in ('pending','approved','retry')),
  spot_passed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on app.submission (student_id);

alter table app.class enable row level security;
alter table app.team enable row level security;
alter table app.student enable row level security;
alter table app.student_session enable row level security;
alter table app.teacher_session enable row level security;
alter table app.reading enable row level security;
alter table app.submission enable row level security;

-- Internal helpers
create function app.new_token() returns text language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;
create function app.hash_token(t text) returns bytea language sql immutable set search_path = '' as $$
  select sha256(convert_to(t, 'UTF8'))
$$;
create function app.student_from(p_token text) returns app.student language plpgsql stable set search_path = '' as $$
declare r app.student;
begin
  select s.* into r from app.student_session x join app.student s on s.id = x.student_id
    where x.token_hash = app.hash_token(p_token) and x.expires_at > now();
  if not found then raise exception 'auth'; end if;
  return r;
end $$;
create function app.class_from(p_token text) returns uuid language plpgsql stable set search_path = '' as $$
declare c uuid;
begin
  select class_id into c from app.teacher_session where token_hash = app.hash_token(p_token) and expires_at > now();
  if not found then raise exception 'auth'; end if;
  return c;
end $$;
create function app.student_points(p uuid) returns int language sql stable set search_path = '' as $$
  select coalesce(sum(10 + case when teammate then 2 else 0 end + case when spot_passed then 3 else 0 end), 0)::int
  from app.submission where student_id = p and status = 'approved'
$$;
create function app.board(p uuid) returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'members', m.n, 'total', m.total,
      'avg', case when m.n > 0 then round(m.total::numeric / m.n)::int else 0 end) order by t.sort, t.created_at), '[]'::jsonb)
  from app.team t cross join lateral (
    select count(*)::int n, coalesce(sum(app.student_points(s.id)), 0)::int total from app.student s where s.team_id = t.id
  ) m where t.class_id = p
$$;
create function app.filled(c jsonb, keys text[]) returns boolean language sql immutable set search_path = '' as $$
  select bool_and(length(btrim(coalesce(c ->> k, ''))) between 1 and 2000) from unnest(keys) k
$$;
-- Checks a student's work and raises a short code the site turns into a friendly message.
create function app.check_work(p jsonb) returns void language plpgsql immutable set search_path = '' as $$
declare proof text := p ->> 'proof'; c jsonb := coalesce(p -> 'content', '{}'::jsonb); words int;
begin
  if length(btrim(coalesce(p ->> 'title', ''))) not between 1 and 120 then raise exception 'title'; end if;
  if length(coalesce(p ->> 'pages', '')) > 40 then raise exception 'invalid'; end if;
  if proof = 'map' then
    if not app.filled(c, array['somebody','wanted','but','so','then']) then raise exception 'incomplete'; end if;
  elsif proof = 'idea' then
    if not app.filled(c, array['main','d1','d2','d3']) then raise exception 'incomplete'; end if;
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

-- Student sign-in
create function public.class_roster(p_code text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c app.class;
begin
  select * into c from app.class where code = upper(btrim(p_code));
  if not found then raise exception 'bad_code'; end if;
  return jsonb_build_object('class_name', c.name, 'students', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.first_name) order by s.first_name)
    from app.student s where s.class_id = c.id), '[]'::jsonb));
end $$;

create function public.student_login(p_code text, p_student uuid, p_pin text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s app.student; tok text;
begin
  select st.* into s from app.student st join app.class c on c.id = st.class_id
    where st.id = p_student and c.code = upper(btrim(p_code));
  if not found then raise exception 'bad_code'; end if;
  if s.locked_until > now() then raise exception 'locked'; end if;
  if s.pin <> p_pin then
    update app.student set failed = case when failed >= 4 then 0 else failed + 1 end,
      locked_until = case when failed >= 4 then now() + interval '1 minute' else null end where id = s.id;
    return jsonb_build_object('error', 'wrong_pin');
  end if;
  update app.student set failed = 0, locked_until = null where id = s.id;
  delete from app.student_session where expires_at < now();
  tok := app.new_token();
  insert into app.student_session values (app.hash_token(tok), s.id, now() + interval '60 days');
  return jsonb_build_object('token', tok);
end $$;

create function public.student_logout(p_token text) returns void language sql security definer set search_path = '' as $$
  delete from app.student_session where token_hash = app.hash_token(p_token)
$$;

create function public.student_home(p_token text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s app.student := app.student_from(p_token);
begin
  return jsonb_build_object(
    'me', jsonb_build_object('name', s.first_name, 'team_id', s.team_id,
      'team_name', (select name from app.team where id = s.team_id)),
    'class_name', (select name from app.class where id = s.class_id),
    'points', app.student_points(s.id),
    'stars', (select count(*) from app.submission where student_id = s.id and status = 'approved'),
    'open', (select jsonb_build_object('id', r.id, 'elapsed', floor(extract(epoch from now() - r.started_at))::int)
             from app.reading r where r.student_id = s.id and r.submitted_at is null),
    'work', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title, 'proof', w.proof, 'status', w.status,
              'teammate', w.teammate, 'spot_passed', w.spot_passed, 'created_at', w.created_at) order by w.created_at desc)
             from app.submission w where w.student_id = s.id), '[]'::jsonb),
    'board', app.board(s.class_id));
end $$;

-- Reading timer. The server clock decides when 15 minutes have passed.
create function public.reading_start(p_token text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s app.student := app.student_from(p_token); r app.reading;
begin
  delete from app.reading where student_id = s.id and submitted_at is null and started_at < now() - interval '48 hours';
  select * into r from app.reading where student_id = s.id and submitted_at is null;
  if not found then insert into app.reading (student_id) values (s.id) returning * into r; end if;
  return jsonb_build_object('id', r.id, 'elapsed', floor(extract(epoch from now() - r.started_at))::int);
end $$;

create function public.reading_cancel(p_token text) returns void language plpgsql security definer set search_path = '' as $$
declare s app.student := app.student_from(p_token);
begin
  delete from app.reading where student_id = s.id and submitted_at is null;
end $$;

create function public.submission_create(p_token text, p_reading uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s app.student := app.student_from(p_token); r app.reading; new_id uuid;
begin
  select * into r from app.reading where id = p_reading and student_id = s.id and submitted_at is null;
  if not found then raise exception 'no_reading'; end if;
  if now() - r.started_at < interval '895 seconds' then raise exception 'too_soon'; end if;
  perform app.check_work(p);
  update app.reading set submitted_at = now() where id = r.id;
  insert into app.submission (student_id, reading_id, title, pages, proof, content, drawing, score, teammate, jfk)
    values (s.id, r.id, btrim(p ->> 'title'), coalesce(p ->> 'pages', ''), p ->> 'proof', coalesce(p -> 'content', '{}'::jsonb),
      case when p ->> 'proof' = 'draw' then p ->> 'drawing' end,
      case when p ->> 'proof' = 'achieve' then (p ->> 'score')::int end,
      coalesce((p ->> 'teammate')::boolean, false), coalesce((p ->> 'jfk')::boolean, false))
    returning id into new_id;
  return jsonb_build_object('id', new_id);
end $$;

create function public.submission_get(p_token text, p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s app.student := app.student_from(p_token); j jsonb;
begin
  select to_jsonb(w) - 'student_id' - 'reading_id' into j from app.submission w where w.id = p_id and w.student_id = s.id;
  if j is null then raise exception 'not_found'; end if;
  return j;
end $$;

create function public.submission_resubmit(p_token text, p_id uuid, p jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare s app.student := app.student_from(p_token);
begin
  perform app.check_work(p);
  update app.submission set title = btrim(p ->> 'title'), pages = coalesce(p ->> 'pages', ''), proof = p ->> 'proof',
      content = coalesce(p -> 'content', '{}'::jsonb),
      drawing = case when p ->> 'proof' = 'draw' then p ->> 'drawing' end,
      score = case when p ->> 'proof' = 'achieve' then (p ->> 'score')::int end,
      teammate = coalesce((p ->> 'teammate')::boolean, false), jfk = coalesce((p ->> 'jfk')::boolean, false),
      status = 'pending', updated_at = now()
    where id = p_id and student_id = s.id and status = 'retry';
  if not found then raise exception 'not_found'; end if;
end $$;

-- Teacher sign-in
create function public.teacher_setup(p_code text, p_setup text, p_password text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c app.class; tok text;
begin
  select * into c from app.class where code = upper(btrim(p_code));
  if not found then raise exception 'bad_login'; end if;
  if c.locked_until > now() then raise exception 'locked'; end if;
  if c.setup_code_hash is null or extensions.crypt(p_setup, c.setup_code_hash) <> c.setup_code_hash then
    update app.class set failed = case when failed >= 4 then 0 else failed + 1 end,
      locked_until = case when failed >= 4 then now() + interval '15 minutes' else null end where id = c.id;
    return jsonb_build_object('error', 'bad_login');
  end if;
  if length(p_password) < 8 then raise exception 'short_password'; end if;
  update app.class set teacher_pw_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    setup_code_hash = null, failed = 0, locked_until = null where id = c.id;
  tok := app.new_token();
  insert into app.teacher_session values (app.hash_token(tok), c.id, now() + interval '14 days');
  return jsonb_build_object('token', tok);
end $$;

create function public.teacher_login(p_code text, p_password text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c app.class; tok text;
begin
  select * into c from app.class where code = upper(btrim(p_code));
  if not found then return jsonb_build_object('error', 'bad_login'); end if;
  if c.locked_until > now() then raise exception 'locked'; end if;
  if c.teacher_pw_hash is null or extensions.crypt(p_password, c.teacher_pw_hash) <> c.teacher_pw_hash then
    update app.class set failed = case when failed >= 4 then 0 else failed + 1 end,
      locked_until = case when failed >= 4 then now() + interval '15 minutes' else null end where id = c.id;
    return jsonb_build_object('error', 'bad_login');
  end if;
  update app.class set failed = 0, locked_until = null where id = c.id;
  delete from app.teacher_session where expires_at < now();
  tok := app.new_token();
  insert into app.teacher_session values (app.hash_token(tok), c.id, now() + interval '14 days');
  return jsonb_build_object('token', tok);
end $$;

create function public.teacher_logout(p_token text) returns void language sql security definer set search_path = '' as $$
  delete from app.teacher_session where token_hash = app.hash_token(p_token)
$$;

-- Teacher tools
create function public.teacher_state(p_token text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token);
begin
  return jsonb_build_object(
    'class', (select jsonb_build_object('name', name, 'code', code) from app.class where id = cid),
    'board', app.board(cid),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.first_name, 'team_id', s.team_id, 'pin', s.pin,
        'points', app.student_points(s.id),
        'readings', (select count(*) from app.submission w where w.student_id = s.id and w.status = 'approved'),
        'jfk', (select count(*) from app.submission w where w.student_id = s.id and w.status = 'approved' and w.jfk)) order by s.first_name)
      from app.student s where s.class_id = cid), '[]'::jsonb),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'student_id', w.student_id, 'title', w.title, 'pages', w.pages,
        'proof', w.proof, 'score', w.score, 'teammate', w.teammate, 'jfk', w.jfk, 'status', w.status, 'spot_passed', w.spot_passed,
        'created_at', w.created_at) order by w.created_at desc)
      from app.submission w join app.student s on s.id = w.student_id where s.class_id = cid), '[]'::jsonb));
end $$;

create function public.teacher_submission_get(p_token text, p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token); j jsonb;
begin
  select to_jsonb(w) - 'reading_id' into j from app.submission w join app.student s on s.id = w.student_id
    where w.id = p_id and s.class_id = cid;
  if j is null then raise exception 'not_found'; end if;
  return j;
end $$;

create function public.teacher_review(p_token text, p_id uuid, p_status text, p_spot boolean) returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token);
begin
  if p_status not in ('pending','approved','retry') then raise exception 'invalid'; end if;
  update app.submission w set status = p_status, spot_passed = p_status = 'approved' and p_spot, updated_at = now()
    from app.student s where s.id = w.student_id and w.id = p_id and s.class_id = cid;
  if not found then raise exception 'not_found'; end if;
end $$;

create function public.teacher_set_jfk(p_token text, p_id uuid, p_jfk boolean) returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token);
begin
  update app.submission w set jfk = p_jfk, updated_at = now()
    from app.student s where s.id = w.student_id and w.id = p_id and s.class_id = cid;
  if not found then raise exception 'not_found'; end if;
end $$;

create function public.teacher_add_reading(p_token text, p_student uuid, p_title text, p_teammate boolean, p_jfk boolean) returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token);
begin
  if not exists (select 1 from app.student where id = p_student and class_id = cid) then raise exception 'not_found'; end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'title'; end if;
  insert into app.submission (student_id, title, proof, teammate, jfk, status)
    values (p_student, btrim(p_title), 'teacher', coalesce(p_teammate, false), coalesce(p_jfk, false), 'approved');
end $$;

create function public.teacher_delete_submission(p_token text, p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token);
begin
  delete from app.submission w using app.student s where s.id = w.student_id and w.id = p_id and s.class_id = cid;
end $$;

create function public.teacher_class_rename(p_token text, p_name text) returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token);
begin
  if length(btrim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'invalid'; end if;
  update app.class set name = btrim(p_name) where id = cid;
end $$;

create function public.teacher_team_add(p_token text, p_name text) returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token);
begin
  if length(btrim(coalesce(p_name, ''))) not between 1 and 14 then raise exception 'invalid'; end if;
  insert into app.team (class_id, name, sort)
    values (cid, btrim(p_name), (select coalesce(max(sort), 0) + 1 from app.team where class_id = cid));
end $$;

create function public.teacher_team_delete(p_token text, p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token);
begin
  delete from app.team where id = p_id and class_id = cid;
end $$;

create function public.teacher_student_add(p_token text, p_name text, p_team uuid) returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token);
begin
  if length(btrim(coalesce(p_name, ''))) not between 1 and 30 then raise exception 'invalid'; end if;
  if not exists (select 1 from app.team where id = p_team and class_id = cid) then raise exception 'not_found'; end if;
  insert into app.student (class_id, team_id, first_name, pin)
    values (cid, p_team, btrim(p_name), lpad(floor(random() * 10000)::int::text, 4, '0'));
end $$;

create function public.teacher_student_move(p_token text, p_id uuid, p_team uuid) returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token);
begin
  if not exists (select 1 from app.team where id = p_team and class_id = cid) then raise exception 'not_found'; end if;
  update app.student set team_id = p_team where id = p_id and class_id = cid;
end $$;

create function public.teacher_student_new_pin(p_token text, p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token);
begin
  update app.student set pin = lpad(floor(random() * 10000)::int::text, 4, '0'), failed = 0, locked_until = null
    where id = p_id and class_id = cid;
  delete from app.student_session where student_id = p_id and exists (select 1 from app.student where id = p_id and class_id = cid);
end $$;

create function public.teacher_student_delete(p_token text, p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid := app.class_from(p_token);
begin
  delete from app.student where id = p_id and class_id = cid;
end $$;

-- Only the site's public key may call the public functions.
revoke all on all functions in schema public from public, authenticated;
grant execute on all functions in schema public to anon;
