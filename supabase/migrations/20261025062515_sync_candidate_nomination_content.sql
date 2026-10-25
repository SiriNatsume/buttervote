-- Candidate management edits must update their originating nomination in the
-- same transaction. Preserve review state, submitter, timestamps of submission,
-- and inheritance; never follow a nomination link into another contest.
create or replace function buttervote_private.sync_candidate_nomination_content()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.nomination_id is not null then
    update public.nominations as nomination set
      name = new.name,
      description = new.description,
      nominator_display_name = new.nominator_display_name,
      image_path = new.image_path,
      image_width = new.image_width,
      image_height = new.image_height,
      image_size = new.image_size
    where nomination.id = new.nomination_id
      and nomination.contest_id = new.contest_id;
    -- Even a same-path image replacement can keep dimensions and byte size.
    -- Touching updated_at also versions the personal/receipt image URL.
  end if;
  return null;
end;
$$;
revoke all on function buttervote_private.sync_candidate_nomination_content() from public, anon, authenticated, service_role;

create trigger sync_candidate_nomination_content
after update of name, description, nominator_display_name, image_path, image_width, image_height, image_size
on public.candidates for each row
execute function buttervote_private.sync_candidate_nomination_content();
