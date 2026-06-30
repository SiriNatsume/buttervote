create index if not exists tournament_draw_logs_retracted_by_idx
  on public.tournament_draw_logs(retracted_by)
  where retracted_by is not null;
