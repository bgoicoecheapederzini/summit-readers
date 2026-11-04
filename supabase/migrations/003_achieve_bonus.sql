-- Achieve3000 readings scoring over 75% earn 3 extra points.
create or replace function app.student_points(p uuid) returns int language sql stable set search_path = '' as $$
  select coalesce(sum(10 + case when spot_passed then 3 else 0 end + case when proof = 'achieve' and score > 75 then 3 else 0 end), 0)::int
  from app.submission where student_id = p and status = 'approved'
$$;

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
    'work', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title, 'proof', w.proof, 'score', w.score, 'status', w.status,
              'spot_passed', w.spot_passed, 'created_at', w.created_at) order by w.created_at desc)
             from app.submission w where w.student_id = s.id), '[]'::jsonb),
    'class_readings', (select count(*) from app.submission w join app.student x on x.id = w.student_id
             where x.class_id = s.class_id and w.status = 'approved'),
    'classmates', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.first_name, 'points', app.student_points(x.id),
              'stars', (select count(*) from app.submission w where w.student_id = x.id and w.status = 'approved')) order by x.first_name)
             from app.student x where x.class_id = s.class_id), '[]'::jsonb));
end $$;

revoke all on all functions in schema public from public, authenticated;
grant execute on all functions in schema public to anon;
