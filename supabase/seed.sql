insert into public.contests (
  id,
  title,
  description,
  status,
  vote_type,
  max_choices,
  created_by
) values
  (
    '11111111-1111-1111-1111-111111111111',
    '年度最佳作品',
    '从本年度入围作品中选出最受认可的一项。',
    'published',
    'single',
    1,
    null
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    '最受欢迎角色',
    '选择你最喜欢的角色，最多可选两位。',
    'voting',
    'multiple',
    2,
    null
  )
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  vote_type = excluded.vote_type,
  max_choices = excluded.max_choices;

insert into public.candidates (
  id,
  contest_id,
  name,
  description
) values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '11111111-1111-1111-1111-111111111111',
    '海边日记',
    '一部安静克制、情绪细腻的短片作品。'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    '11111111-1111-1111-1111-111111111111',
    '星河计划',
    '关于协作、探索与长期主义的科幻作品。'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    '11111111-1111-1111-1111-111111111111',
    '旧城新声',
    '以城市记忆为线索的音乐纪录项目。'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
    '11111111-1111-1111-1111-111111111111',
    '山间来信',
    '温暖、轻盈，适合慢慢阅读的影像散文。'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    '22222222-2222-2222-2222-222222222222',
    '林夏',
    '行动果断，始终把伙伴放在第一位。'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '22222222-2222-2222-2222-222222222222',
    '周野',
    '外冷内热，拥有很强的问题解决能力。'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
    '22222222-2222-2222-2222-222222222222',
    '阿澈',
    '乐观幽默，是团队里的气氛担当。'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
    '22222222-2222-2222-2222-222222222222',
    '沈青',
    '冷静敏锐，擅长在关键时刻做判断。'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5',
    '22222222-2222-2222-2222-222222222222',
    '小满',
    '真诚直接，具有很强的感染力。'
  )
on conflict (id) do update set
  contest_id = excluded.contest_id,
  name = excluded.name,
  description = excluded.description;

-- 如果你希望种子数据带管理员，请先注册账号，再手动执行：
-- update public.profiles set role = 'admin' where email = 'you@example.com';
