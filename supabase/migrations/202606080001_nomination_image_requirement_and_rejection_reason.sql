alter table public.contests
  add column if not exists nomination_image_required boolean not null default false;

alter table public.nominations
  add column if not exists rejection_reason text,
  add column if not exists rejected_at timestamptz;

alter table public.nominations
  drop constraint if exists nominations_status_check;

alter table public.nominations
  add constraint nominations_status_check
  check (status in ('draft', 'pending', 'approved', 'rejected'));

create index if not exists idx_nominations_submitter_status
on public.nominations(submitter_id, status);
