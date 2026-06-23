drop policy if exists "Anyone can read tournament draw logs" on public.tournament_draw_logs;

revoke select on public.tournament_draw_logs from anon;
grant select on public.tournament_draw_logs to authenticated;