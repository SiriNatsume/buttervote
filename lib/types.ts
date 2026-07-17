export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ContestStatus =
  | "draft"
  | "nominating"
  | "admin_nominating"
  | "waiting"
  | "voting"
  | "closed"
  | "published";

export type VoteType = "single" | "multiple" | "ranked";

export type NominationStatus = "draft" | "pending" | "approved" | "rejected";
export type ClosedResultVisibility = "admin_only" | "public";
export type ScheduledTransitionTarget = ContestStatus;
export type ContestGroupAccessMode = "public" | "restricted";
export type TournamentStatus = "draft" | "active" | "completed" | "archived";
export type TournamentStageKind =
  | "screening"
  | "preliminary"
  | "tiebreaker"
  | "knockout";
export type TournamentStageStatus =
  | "draft"
  | "waiting"
  | "voting"
  | "closed"
  | "published";
export type ContestCallingStatus =
  | "draft"
  | "active"
  | "paused"
  | "completed"
  | "archived";
export type ContestCallingPlayMode = "manual" | "auto";
export type ContestCallingPhase = "base" | "love_bonus";
export type ContestResultVisibilityState =
  | "hidden"
  | "calling_progress"
  | "full";
export type PageVisibility = "admin_only" | "public";
export type PageAssetType = "image" | "attachment";
export type PageAssetExtension =
  | "jpg"
  | "png"
  | "webp"
  | "pdf"
  | "7z"
  | "rar"
  | "xlsx"
  | "docx"
  | "pptx";
export type TournamentEntryStatus =
  | "screening"
  | "preliminary"
  | "tiebreaker"
  | "knockout"
  | "eliminated"
  | "champion"
  | "withdrawn";

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "user" | "admin" | string;
  qq_user_id: string | null;
  qq_nickname: string | null;
  qq_avatar_url: string | null;
  login_provider: string;
  created_at: string;
} & Record<string, unknown>;

export type QQLoginTicket = {
  id: string;
  token_hash: string;
  qq_user_id: string;
  qq_nickname: string | null;
  qq_avatar_url: string | null;
  return_to: string | null;
  user_group_join_codes: string[];
  expires_at: string;
  used_at: string | null;
  created_at: string;
} & Record<string, unknown>;

export type AppSession = {
  id: string;
  profile_id: string;
  session_token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
} & Record<string, unknown>;

export type ContestGroup = {
  id: string;
  name: string;
  description: string | null;
  cover_image_path: string | null;
  cover_image_width: number | null;
  cover_image_height: number | null;
  cover_image_size: number | null;
  love_vote_weight: number;
  love_vote_quota: number;
  access_mode: ContestGroupAccessMode;
  created_by: string | null;
  created_at: string;
  updated_at: string;
} & Record<string, unknown>;

export type UserGroup = {
  id: string;
  name: string;
  description: string | null;
  join_code: string | null;
  created_at: string;
  updated_at: string;
} & Record<string, unknown>;

export type UserGroupMember = {
  id: string;
  user_group_id: string;
  profile_id: string;
  source: string;
  joined_at: string;
  last_verified_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
} & Record<string, unknown>;

export type ContestGroupAllowedUserGroup = {
  id: string;
  contest_group_id: string;
  user_group_id: string;
} & Record<string, unknown>;

export type Contest = {
  id: string;
  title: string;
  description: string | null;
  status: ContestStatus;
  vote_type: VoteType;
  max_choices: number;
  require_exact_choices: boolean;
  group_id: string | null;
  show_candidate_image: boolean;
  show_candidate_description: boolean;
  show_nominator_info: boolean;
  show_existing_nominations: boolean;
  nomination_image_required: boolean;
  max_nominations_per_user: number | null;
  candidate_description_max_length: number | null;
  live_results_enabled: boolean;
  closed_result_visibility: ClosedResultVisibility;
  love_vote_enabled: boolean;
  voting_starts_at: string | null;
  voting_ends_at: string | null;
  image_path: string | null;
  image_width: number | null;
  image_height: number | null;
  image_size: number | null;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
} & Record<string, unknown>;

export type Nomination = {
  id: string;
  contest_id: string;
  submitter_id: string | null;
  name: string;
  description: string | null;
  status: NominationStatus;
  image_path: string | null;
  image_width: number | null;
  image_height: number | null;
  image_size: number | null;
  nominator_display_name: string | null;
  nominator_note: string | null;
  rejection_reason: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
} & Record<string, unknown>;

export type Candidate = {
  id: string;
  contest_id: string;
  nomination_id: string | null;
  name: string;
  description: string | null;
  image_path: string | null;
  image_width: number | null;
  image_height: number | null;
  image_size: number | null;
  nominator_display_name: string | null;
  nominator_note: string | null;
  inherited_from_candidate_id: string | null;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
} & Record<string, unknown>;

export type Vote = {
  id: string;
  contest_id: string;
  voter_id: string | null;
  payload: Json;
  created_at: string;
} & Record<string, unknown>;

export type LoveVoteAllocation = {
  id: string;
  group_id: string | null;
  contest_id: string;
  vote_id: string;
  candidate_id: string;
  voter_id: string;
  created_at: string;
} & Record<string, unknown>;

export type HomepageHeroValue = {
  featuredType?: "group" | "contest" | "tournament";
  featuredId?: string;
  title?: string;
  description?: string;
  showDescription?: boolean;
  imagePath?: string;
};

export type HomepageBracketValue = {
  tournamentId?: string | null;
};

export type SiteSetting = {
  key: string;
  value: Json;
  updated_at: string;
} & Record<string, unknown>;

export type ContestScheduledTransition = {
  id: string;
  contest_id: string;
  target_status: ScheduledTransitionTarget;
  run_at: string;
  executed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
} & Record<string, unknown>;

export type Tournament = {
  id: string;
  name: string;
  status: TournamentStatus;
  config: Json;
  created_by: string | null;
  created_at: string;
  updated_at: string;
} & Record<string, unknown>;

export type TournamentStage = {
  id: string;
  tournament_id: string;
  kind: TournamentStageKind;
  contest_id: string | null;
  group_id: string | null;
  sequence: number;
  status: TournamentStageStatus;
  metadata: Json;
  created_at: string;
  updated_at: string;
} & Record<string, unknown>;

export type TournamentEntry = {
  id: string;
  tournament_id: string;
  root_candidate_id: string;
  current_candidate_id: string | null;
  source_candidate_id: string | null;
  screening_rank: number | null;
  preliminary_group: "A" | "B" | "C" | "D" | null;
  preliminary_rank: number | null;
  is_group_winner: boolean;
  status: TournamentEntryStatus;
  created_at: string;
  updated_at: string;
} & Record<string, unknown>;

export type TournamentDrawLog = {
  id: string;
  tournament_id: string;
  stage_id: string | null;
  kind: string;
  seed: string;
  input: Json;
  output: Json;
  created_by: string | null;
  created_at: string;
  retracted_at: string | null;
  retracted_by: string | null;
  retract_reason: string | null;
} & Record<string, unknown>;

export type TournamentMatch = {
  id: string;
  tournament_id: string;
  stage_id: string | null;
  contest_id: string | null;
  round: string;
  slot: number;
  left_entry_id: string | null;
  right_entry_id: string | null;
  winner_entry_id: string | null;
  loser_entry_id: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
} & Record<string, unknown>;

export type ContestCallingSession = {
  id: string;
  contest_id: string;
  status: ContestCallingStatus;
  current_step: number;
  total_steps: number;
  play_mode: ContestCallingPlayMode;
  auto_interval_seconds: number;
  seed: string;
  metadata: Json;
  created_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
} & Record<string, unknown>;

export type ContestCallingEvent = {
  id: string;
  session_id: string;
  contest_id: string;
  sequence: number;
  phase: ContestCallingPhase;
  candidate_id: string | null;
  delta_score: number;
  candidate_snapshot: Json;
  scores: Json;
  metadata: Json;
  created_at: string;
} & Record<string, unknown>;

export type HallOfFameEntry = {
  id: string;
  contest_id: string | null;
  event_title: string;
  winner_name: string;
  description: string;
  poster_path: string;
  poster_mime_type: "image/jpeg" | "image/png" | "image/webp";
  poster_size: number;
  thumbnail_path: string;
  thumbnail_mime_type: "image/jpeg" | "image/webp";
  thumbnail_size: number;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
} & Record<string, unknown>;

export type ContestGroupHomepageSettings = {
  contest_group_id: string;
  show_bracket: boolean;
  featured_tournament_id: string | null;
  created_at: string;
  updated_at: string;
} & Record<string, unknown>;

export type ContestGroupPage = {
  id: string;
  contest_group_id: string;
  page_id: string;
  sort_order: number;
  created_at: string;
} & Record<string, unknown>;

export type SitePage = {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  content_markdown: string;
  visibility: PageVisibility;
  published_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
} & Record<string, unknown>;

export type PageAsset = {
  id: string;
  original_filename: string;
  storage_path: string;
  extension: PageAssetExtension;
  mime_type: string;
  byte_size: number;
  asset_type: PageAssetType;
  visibility: PageVisibility;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
} & Record<string, unknown>;

type Table<
  Row extends Record<string, unknown>,
  Insert extends Record<string, unknown>,
  Update extends Record<string, unknown>,
  Relationships extends Relationship[] = [],
> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: Relationships;
};

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Tables = {
  site_pages: Table<
    SitePage,
    {
      id?: string;
      title: string;
      description?: string | null;
      slug: string;
      content_markdown?: string;
      visibility?: PageVisibility;
      published_at?: string | null;
      created_by?: string | null;
      updated_by?: string | null;
      created_at?: string;
      updated_at?: string;
    },
    Partial<Omit<SitePage, "id" | "created_at">>
  >;
  page_assets: Table<
    PageAsset,
    {
      id?: string;
      original_filename: string;
      storage_path: string;
      extension: PageAssetExtension;
      mime_type: string;
      byte_size: number;
      asset_type: PageAssetType;
      visibility?: PageVisibility;
      uploaded_by?: string | null;
      created_at?: string;
      updated_at?: string;
    },
    Partial<Omit<PageAsset, "id" | "created_at">>
  >;
  hall_of_fame_entries: Table<
    HallOfFameEntry,
    {
      id?: string;
      contest_id?: string | null;
      event_title: string;
      winner_name: string;
      description?: string;
      poster_path: string;
      poster_mime_type: "image/jpeg" | "image/png" | "image/webp";
      poster_size: number;
      thumbnail_path: string;
      thumbnail_mime_type: "image/jpeg" | "image/webp";
      thumbnail_size: number;
      sort_order?: number;
      created_by?: string | null;
      created_at?: string;
      updated_at?: string;
    },
    Partial<Omit<HallOfFameEntry, "id" | "created_at">>,
    [
      {
        foreignKeyName: "hall_of_fame_entries_contest_id_fkey";
        columns: ["contest_id"];
        isOneToOne: false;
        referencedRelation: "contests";
        referencedColumns: ["id"];
      },
    ]
  >;
  profiles: Table<
    Profile,
    {
      id: string;
      email?: string | null;
      display_name?: string | null;
      role?: string;
      qq_user_id?: string | null;
      qq_nickname?: string | null;
      qq_avatar_url?: string | null;
      login_provider?: string;
      created_at?: string;
    },
    Partial<Omit<Profile, "id" | "created_at">>
  >;
  qq_login_tickets: Table<
    QQLoginTicket,
    {
      id?: string;
      token_hash: string;
      qq_user_id: string;
      qq_nickname?: string | null;
      qq_avatar_url?: string | null;
      return_to?: string | null;
      user_group_join_codes?: string[];
      expires_at: string;
      used_at?: string | null;
      created_at?: string;
    },
    Partial<Omit<QQLoginTicket, "id" | "created_at">>
  >;
  app_sessions: Table<
    AppSession,
    {
      id?: string;
      profile_id: string;
      session_token_hash: string;
      expires_at: string;
      revoked_at?: string | null;
      created_at?: string;
    },
    Partial<Omit<AppSession, "id" | "created_at">>
  >;
  contests: Table<
    Contest,
    {
      id?: string;
      title: string;
      description?: string | null;
      status?: ContestStatus;
      vote_type?: VoteType;
      max_choices?: number;
      require_exact_choices?: boolean;
      group_id?: string | null;
      show_candidate_image?: boolean;
      show_candidate_description?: boolean;
      show_nominator_info?: boolean;
      show_existing_nominations?: boolean;
      nomination_image_required?: boolean;
      max_nominations_per_user?: number | null;
      candidate_description_max_length?: number | null;
      live_results_enabled?: boolean;
      closed_result_visibility?: ClosedResultVisibility;
      love_vote_enabled?: boolean;
      voting_starts_at?: string | null;
      voting_ends_at?: string | null;
      image_path?: string | null;
      image_width?: number | null;
      image_height?: number | null;
      image_size?: number | null;
      created_by?: string | null;
      archived_at?: string | null;
      created_at?: string;
      updated_at?: string;
    },
    Partial<Omit<Contest, "id" | "created_at">>
  >;
  contest_groups: Table<
    ContestGroup,
    {
      id?: string;
      name: string;
      description?: string | null;
      cover_image_path?: string | null;
      cover_image_width?: number | null;
      cover_image_height?: number | null;
      cover_image_size?: number | null;
      love_vote_weight?: number;
      love_vote_quota?: number;
      access_mode?: ContestGroupAccessMode;
      created_by?: string | null;
      created_at?: string;
      updated_at?: string;
    },
    Partial<Omit<ContestGroup, "id" | "created_at">>
  >;
  contest_group_homepage_settings: Table<
    ContestGroupHomepageSettings,
    {
      contest_group_id: string;
      show_bracket?: boolean;
      featured_tournament_id?: string | null;
      created_at?: string;
      updated_at?: string;
    },
    Partial<Omit<ContestGroupHomepageSettings, "contest_group_id" | "created_at">>
  >;
  contest_group_pages: Table<
    ContestGroupPage,
    {
      id?: string;
      contest_group_id: string;
      page_id: string;
      sort_order?: number;
      created_at?: string;
    },
    Partial<Omit<ContestGroupPage, "id" | "created_at">>
  >;
  user_groups: Table<
    UserGroup,
    {
      id?: string;
      name: string;
      description?: string | null;
      join_code?: string | null;
      created_at?: string;
      updated_at?: string;
    },
    Partial<Omit<UserGroup, "id" | "created_at">>
  >;
  user_group_members: Table<
    UserGroupMember,
    {
      id?: string;
      user_group_id: string;
      profile_id: string;
      source?: string;
      joined_at?: string;
      last_verified_at?: string | null;
      expires_at?: string | null;
      revoked_at?: string | null;
    },
    Partial<Omit<UserGroupMember, "id" | "joined_at">>
  >;
  contest_group_allowed_user_groups: Table<
    ContestGroupAllowedUserGroup,
    {
      id?: string;
      contest_group_id: string;
      user_group_id: string;
    },
    Partial<Omit<ContestGroupAllowedUserGroup, "id">>
  >;
  nominations: Table<
    Nomination,
    {
      id?: string;
      contest_id: string;
      submitter_id?: string | null;
      name: string;
      description?: string | null;
      status?: NominationStatus;
      image_path?: string | null;
      image_width?: number | null;
      image_height?: number | null;
      image_size?: number | null;
      nominator_display_name?: string | null;
      nominator_note?: string | null;
      rejection_reason?: string | null;
      rejected_at?: string | null;
      created_at?: string;
      updated_at?: string;
    },
    Partial<Omit<Nomination, "id" | "created_at">>,
    [
      {
        foreignKeyName: "nominations_contest_id_fkey";
        columns: ["contest_id"];
        isOneToOne: false;
        referencedRelation: "contests";
        referencedColumns: ["id"];
      },
    ]
  >;
  candidates: Table<
    Candidate,
    {
      id?: string;
      contest_id: string;
      nomination_id?: string | null;
      name: string;
      description?: string | null;
      image_path?: string | null;
      image_width?: number | null;
      image_height?: number | null;
      image_size?: number | null;
      nominator_display_name?: string | null;
      nominator_note?: string | null;
      inherited_from_candidate_id?: string | null;
      is_active?: boolean;
      deleted_at?: string | null;
      created_at?: string;
    },
    Partial<Omit<Candidate, "id" | "created_at">>
  >;
  votes: Table<
    Vote,
    {
      id?: string;
      contest_id: string;
      voter_id?: string | null;
      payload: Json;
      created_at?: string;
    },
    Partial<Omit<Vote, "id" | "created_at">>
  >;
  love_vote_allocations: Table<
    LoveVoteAllocation,
    {
      id?: string;
      group_id?: string | null;
      contest_id: string;
      vote_id: string;
      candidate_id: string;
      voter_id: string;
      created_at?: string;
    },
    Partial<Omit<LoveVoteAllocation, "id" | "created_at">>
  >;
  site_settings: Table<
    SiteSetting,
    {
      key: string;
      value: Json;
      updated_at?: string;
    },
    Partial<Omit<SiteSetting, "key">>
  >;
  contest_scheduled_transitions: Table<
    ContestScheduledTransition,
    {
      id?: string;
      contest_id: string;
      target_status: ScheduledTransitionTarget;
      run_at: string;
      executed_at?: string | null;
      created_by?: string | null;
      created_at?: string;
      updated_at?: string;
    },
    Partial<Omit<ContestScheduledTransition, "id" | "created_at">>
  >;
  tournaments: Table<
    Tournament,
    {
      id?: string;
      name: string;
      status?: TournamentStatus;
      config?: Json;
      created_by?: string | null;
      created_at?: string;
      updated_at?: string;
    },
    Partial<Omit<Tournament, "id" | "created_at">>
  >;
  tournament_stages: Table<
    TournamentStage,
    {
      id?: string;
      tournament_id: string;
      kind: TournamentStageKind;
      contest_id?: string | null;
      group_id?: string | null;
      sequence?: number;
      status?: TournamentStageStatus;
      metadata?: Json;
      created_at?: string;
      updated_at?: string;
    },
    Partial<Omit<TournamentStage, "id" | "created_at">>
  >;
  tournament_entries: Table<
    TournamentEntry,
    {
      id?: string;
      tournament_id: string;
      root_candidate_id: string;
      current_candidate_id?: string | null;
      source_candidate_id?: string | null;
      screening_rank?: number | null;
      preliminary_group?: "A" | "B" | "C" | "D" | null;
      preliminary_rank?: number | null;
      is_group_winner?: boolean;
      status?: TournamentEntryStatus;
      created_at?: string;
      updated_at?: string;
    },
    Partial<Omit<TournamentEntry, "id" | "created_at">>
  >;
  tournament_draw_logs: Table<
    TournamentDrawLog,
    {
      id?: string;
      tournament_id: string;
      stage_id?: string | null;
      kind: string;
      seed: string;
      input?: Json;
      output?: Json;
      created_by?: string | null;
      created_at?: string;
      retracted_at?: string | null;
      retracted_by?: string | null;
      retract_reason?: string | null;
    },
    Partial<Omit<TournamentDrawLog, "id" | "created_at">>
  >;
  tournament_matches: Table<
    TournamentMatch,
    {
      id?: string;
      tournament_id: string;
      stage_id?: string | null;
      contest_id?: string | null;
      round: string;
      slot: number;
      left_entry_id?: string | null;
      right_entry_id?: string | null;
      winner_entry_id?: string | null;
      loser_entry_id?: string | null;
      metadata?: Json;
      created_at?: string;
      updated_at?: string;
    },
    Partial<Omit<TournamentMatch, "id" | "created_at">>
  >;
  contest_calling_sessions: Table<
    ContestCallingSession,
    {
      id?: string;
      contest_id: string;
      status?: ContestCallingStatus;
      current_step?: number;
      total_steps?: number;
      play_mode?: ContestCallingPlayMode;
      auto_interval_seconds?: number;
      seed: string;
      metadata?: Json;
      created_by?: string | null;
      started_at?: string | null;
      completed_at?: string | null;
      archived_at?: string | null;
      created_at?: string;
      updated_at?: string;
    },
    Partial<Omit<ContestCallingSession, "id" | "created_at">>
  >;
  contest_calling_events: Table<
    ContestCallingEvent,
    {
      id?: string;
      session_id: string;
      contest_id: string;
      sequence: number;
      phase: ContestCallingPhase;
      candidate_id?: string | null;
      delta_score?: number;
      candidate_snapshot?: Json;
      scores?: Json;
      metadata?: Json;
      created_at?: string;
    },
    Partial<Omit<ContestCallingEvent, "id" | "created_at">>
  >;
};

export type Database = {
  public: {
    Tables: Tables;
    Views: Record<string, never>;
    Functions: {
      get_group_homepage_contests: {
        Args: {
          p_group_id: string;
          p_recent_limit?: number;
        };
        Returns: Contest[];
      };
      get_visible_contest_tallies: {
        Args: {
          p_contest_ids: string[];
          p_include_admin_override?: boolean;
        };
        Returns: Array<{
          contest_id: string;
          candidate_id: string;
          score: number;
          normal_score: number;
          love_score: number;
          love_vote_count: number;
          last_vote_at: string | null;
        }>;
      };
      set_contest_group_pages: {
        Args: {
          p_contest_group_id: string;
          p_page_ids?: string[];
        };
        Returns: undefined;
      };
      reorder_hall_of_fame_entries: {
        Args: {
          p_entry_ids: string[];
        };
        Returns: undefined;
      };
      get_contest_result_visibility: {
        Args: {
          p_contest_ids: string[];
          p_include_admin_override?: boolean;
        };
        Returns: Array<{
          contest_id: string;
          visibility_state: ContestResultVisibilityState;
          result_page_visible: boolean;
          full_results_visible: boolean;
          calling_progress_visible: boolean;
          full_results_blocked_by_calling: boolean;
          show_weighted_love_score: boolean;
          reason: string;
          calling_session_id: string | null;
          calling_session_status: string | null;
          visibility_version: string | null;
        }>;
      };
      get_visible_contest_vote_payloads: {
        Args: {
          p_contest_ids: string[];
          p_include_admin_override?: boolean;
        };
        Returns: Array<{
          id: string;
          contest_id: string;
          payload: Json;
          created_at: string;
        }>;
      };
      get_visible_contest_love_vote_allocations: {
        Args: {
          p_contest_ids: string[];
          p_include_admin_override?: boolean;
        };
        Returns: Array<{
          contest_id: string;
          vote_id: string;
          candidate_id: string;
        }>;
      };
      get_contest_vote_payloads: {
        Args: {
          p_contest_id: string;
        };
        Returns: Array<{
          id: string;
          contest_id: string;
          payload: Json;
          created_at: string;
        }>;
      };
      get_contest_love_vote_allocations: {
        Args: {
          p_contest_id: string;
        };
        Returns: Array<{
          vote_id: string;
          candidate_id: string;
        }>;
      };
      can_view_contest_results: {
        Args: {
          p_contest_id: string;
        };
        Returns: boolean;
      };
      can_read_candidate: {
        Args: {
          p_candidate_id: string;
        };
        Returns: boolean;
      };
      get_visible_contest_nominations: {
        Args: {
          p_contest_id: string;
        };
        Returns: Array<{
          id: string;
          name: string;
          description: string | null;
          status: NominationStatus;
          nominator_display_name: string | null;
          created_at: string;
        }>;
      };
      complete_contest_calling_session: {
        Args: {
          p_session_id: string;
        };
        Returns: Array<{
          contest_id: string;
          session_status: string;
          contest_status: string;
          completed_at: string;
        }>;
      };
      apply_due_scheduled_transitions: {
        Args: {
          p_contest_id?: string | null;
        };
        Returns: Array<{
          transition_id: string;
          contest_id: string;
          target_status: string;
          run_at: string;
          group_id: string | null;
        }>;
      };
      archive_contest_atomic: {
        Args: {
          p_contest_id: string;
          p_archived_by: string;
        };
        Returns: Json;
      };
      submit_vote_with_love: {
        Args: {
          p_contest_id: string;
          p_voter_id: string;
          p_payload: Json;
          p_love_candidate_ids?: string[] | null;
        };
        Returns: string;
      };
      submit_group_votes_with_love: {
        Args: {
          p_group_id: string;
          p_voter_id: string;
          p_votes: Json;
        };
        Returns: number;
      };
      supplement_love_votes: {
        Args: {
          p_group_id: string;
          p_voter_id: string;
          p_requests: Json;
        };
        Returns: number;
      };
      review_nominations_atomic: {
        Args: {
          p_nomination_ids: string[];
          p_action: "approve" | "reject";
        };
        Returns: string[];
      };
      inherit_candidates_atomic: {
        Args: {
          p_target_contest_id: string;
          p_source_contest_id: string;
          p_source_candidate_ids: string[];
        };
        Returns: number;
      };
      update_contest_group_access_atomic: {
        Args: {
          p_group_id: string;
          p_access_mode: ContestGroupAccessMode;
          p_allowed_user_group_ids?: string[] | null;
        };
        Returns: boolean;
      };
      create_preliminary_stage_atomic: {
        Args: {
          p_tournament_id: string;
          p_screening_stage_id: string;
          p_target_group_id?: string | null;
          p_seed: string;
          p_input: Json;
          p_output: Json;
          p_groups: Json;
          p_created_by: string;
        };
        Returns: Json;
      };
      create_tournament_with_screening_stage_atomic: {
        Args: {
          p_name: string;
          p_screening_contest_id: string;
          p_config: Json;
          p_created_by: string;
        };
        Returns: Json;
      };
      create_preliminary_tiebreakers_atomic: {
        Args: {
          p_tournament_id: string;
          p_target_group_id?: string | null;
          p_seed: string;
          p_input: Json;
          p_output: Json;
          p_tiebreakers: Json;
          p_created_by: string;
        };
        Returns: Json;
      };
      create_knockout_stage_atomic: {
        Args: {
          p_tournament_id: string;
          p_target_group_id?: string | null;
          p_seed: string;
          p_input: Json;
          p_output: Json;
          p_entries: Json;
          p_matches: Json;
          p_created_by: string;
        };
        Returns: Json;
      };
      create_knockout_followup_matches_atomic: {
        Args: {
          p_tournament_id: string;
          p_target_group_id?: string | null;
          p_seed: string;
          p_input: Json;
          p_output: Json;
          p_source_results: Json;
          p_matches: Json;
          p_created_by: string;
        };
        Returns: Json;
      };
      retract_tournament_draw_atomic: {
        Args: {
          p_tournament_id: string;
          p_draw_log_id: string;
          p_reason: string;
          p_retracted_by: string;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
