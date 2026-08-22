create table public.stages (
  id bigint generated always as identity primary key,
  stage_number integer not null unique check (stage_number between 1 and 30),
  stage_name text,
  result_date date,
  pcs_url text not null unique,
  status text not null default 'scheduled' check (status in ('scheduled', 'published')),
  imported_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.predictions (
  id bigint generated always as identity primary key,
  stage_id bigint not null references public.stages(id) on delete cascade,
  participant_name text not null check (char_length(participant_name) between 2 and 80),
  participant_email text not null,
  rider_keys text[] not null check (cardinality(rider_keys) = 5),
  rider_names text[] not null check (cardinality(rider_names) = 5),
  submitted_at timestamptz not null default now(),
  unique (stage_id, participant_email)
);

create table public.stage_results (
  stage_id bigint not null references public.stages(id) on delete cascade,
  finish_position integer not null check (finish_position between 1 and 30),
  rider_key text not null,
  rider_name text not null,
  points integer not null check (points > 0),
  primary key (stage_id, finish_position),
  unique (stage_id, rider_key)
);

create index predictions_stage_id_idx on public.predictions(stage_id);
create index stage_results_stage_id_idx on public.stage_results(stage_id);

-- One row per submitted player/stage. JSON keeps the UI's scoring-rider detail in one request.
create view public.stage_scores as
select
  p.stage_id,
  p.participant_name,
  coalesce(sum(r.points), 0)::integer as points,
  coalesce(jsonb_agg(jsonb_build_object('rider_name', r.rider_name, 'points', r.points) order by r.finish_position) filter (where r.rider_key is not null), '[]'::jsonb) as scoring_riders
from public.predictions p
left join public.stage_results r on r.stage_id = p.stage_id and r.rider_key = any(p.rider_keys)
group by p.id, p.stage_id, p.participant_name;

create view public.leaderboard as
select participant_name, sum(points)::integer as total_points, count(*)::integer as stages_scored
from public.stage_scores
group by participant_name;

-- Deliberately narrow public API surface: published stages and no email addresses.
create view public.public_stages as
select id, stage_number, stage_name, result_date, pcs_url
from public.stages
where status = 'published';

create view public.public_predictions as
select p.stage_id, p.participant_name, p.rider_names
from public.predictions p
join public.stages s on s.id = p.stage_id
where s.status = 'published';

alter table public.stages enable row level security;
alter table public.predictions enable row level security;
alter table public.stage_results enable row level security;
grant select on public.stage_scores, public.leaderboard, public.public_stages, public.public_predictions to anon;

-- Seed all routes so Google Form submissions can arrive before a result is scraped.
insert into public.stages(stage_number, pcs_url)
select n, format('https://www.procyclingstats.com/race/vuelta-a-espana/2026/stage-%s/result/result', n)
from generate_series(1, 21) as n;
