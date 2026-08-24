-- Keep the database schema aligned with cancelled-stage handling.
alter table public.stages
  drop constraint if exists stages_status_check;

alter table public.stages
  add constraint stages_status_check
  check (status in ('scheduled', 'published', 'cancelled'));

-- Anonymous visitors can read only official results from published stages.
create or replace view public.public_stage_results as
select
  r.stage_id,
  s.stage_number,
  s.stage_name,
  r.finish_position,
  r.rider_name,
  r.points
from public.stage_results r
join public.stages s on s.id = r.stage_id
where s.status = 'published';

grant select on public.public_stage_results to anon;
