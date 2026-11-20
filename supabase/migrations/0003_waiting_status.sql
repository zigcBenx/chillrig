alter table public.boxes drop constraint if exists boxes_status_check;
alter table public.boxes add constraint boxes_status_check
  check (status in ('provisioning', 'waiting', 'running', 'destroying', 'destroyed', 'error'));
