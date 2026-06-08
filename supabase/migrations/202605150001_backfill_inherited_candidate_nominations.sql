do $$
declare
  candidate_record record;
  created_nomination_id uuid;
begin
  for candidate_record in
    select
      id,
      contest_id,
      name,
      description,
      image_path,
      image_width,
      image_height,
      image_size,
      nominator_display_name,
      nominator_note
    from public.candidates
    where inherited_from_candidate_id is not null
      and nomination_id is null
  loop
    insert into public.nominations (
      contest_id,
      submitter_id,
      name,
      description,
      status,
      image_path,
      image_width,
      image_height,
      image_size,
      nominator_display_name,
      nominator_note
    )
    values (
      candidate_record.contest_id,
      null,
      candidate_record.name,
      candidate_record.description,
      'approved',
      candidate_record.image_path,
      candidate_record.image_width,
      candidate_record.image_height,
      candidate_record.image_size,
      candidate_record.nominator_display_name,
      candidate_record.nominator_note
    )
    returning id into created_nomination_id;

    update public.candidates
    set nomination_id = created_nomination_id
    where id = candidate_record.id
      and nomination_id is null;
  end loop;
end $$;
