-- Pre-authentication discovery returns booleans only, never Auth IDs or hashes.
create schema if not exists buttervote_private;
revoke all on schema buttervote_private from public, anon, authenticated;
grant usage on schema buttervote_private to service_role;

create or replace function buttervote_private.qq_email_account_state(p_qq_user_id text)
returns table (registered boolean, email_confirmed boolean, has_password boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  -- This lookup runs before user authentication. Require the service role;
  -- there cannot yet be an auth.uid(). Keep elevated access in a private schema.
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_qq_user_id is null or p_qq_user_id !~ '^[1-9][0-9]{4,11}$' then
    raise exception 'INVALID_QQ_ID';
  end if;
  return query
  select
    u.email_confirmed_at is not null or exists (
      select 1 from public.profiles p
      where p.qq_user_id = p_qq_user_id or p.email = p_qq_user_id || '@qq.com'
    ),
    u.email_confirmed_at is not null,
    -- Auth generates a random internal password for admin-provisioned OTP
    -- users. A hash alone does not mean that the user chose a password.
    -- Preserve original email/password profiles (id = Auth user id), while
    -- old canonical QQ/OTP profiles must verify their mailbox and set one.
    coalesce(u.encrypted_password <> '', false) and case
      when u.raw_app_meta_data ? 'qq_password_set'
        then u.raw_app_meta_data->>'qq_password_set' = 'true'
      else exists (select 1 from public.profiles p where p.id = u.id)
    end
  from (select 1) input
  left join auth.users u on u.email = p_qq_user_id || '@qq.com' and u.deleted_at is null;
end;
$$;
revoke all on function buttervote_private.qq_email_account_state(text) from public, anon, authenticated;
grant execute on function buttervote_private.qq_email_account_state(text) to service_role;

create or replace function public.get_qq_email_account_state(p_qq_user_id text)
returns table (registered boolean, email_confirmed boolean, has_password boolean)
language sql stable security invoker set search_path = '' as $$
  select * from buttervote_private.qq_email_account_state(p_qq_user_id);
$$;
revoke all on function public.get_qq_email_account_state(text) from public, anon, authenticated;
grant execute on function public.get_qq_email_account_state(text) to service_role;

notify pgrst, 'reload schema';
