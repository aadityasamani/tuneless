-- ============================================================
-- Tuneless — Supabase Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL)
-- ============================================================

-- 1. User profiles (extends auth.users)
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Settings (one row per user)
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  youtube_api_key text default '',
  crossfade_sec numeric(4,1) default 3.0,
  autoplay boolean default true,
  updated_at timestamptz default now()
);

-- 3. Playlists
create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  track_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_playlists_user on public.playlists(user_id);

-- 4. Playlist tracks
create table if not exists public.playlist_tracks (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  position integer not null default 0,
  name text not null,
  artist text default '',
  yt_id text,
  updated_at timestamptz default now()
);

create index if not exists idx_playlist_tracks_playlist on public.playlist_tracks(playlist_id);
create index if not exists idx_playlist_tracks_user on public.playlist_tracks(user_id);

-- 5. Liked songs
create table if not exists public.liked_songs (
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id text not null,
  title text default '',
  artist text default '',
  yt_id text,
  created_at timestamptz default now(),
  primary key (user_id, track_id)
);

create index if not exists idx_liked_songs_user on public.liked_songs(user_id);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
alter table public.user_profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_tracks enable row level security;
alter table public.liked_songs enable row level security;

-- user_profiles: users can read/update their own profile
create policy "Users can view own profile"
  on public.user_profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.user_profiles for update
  using (auth.uid() = id);

-- user_settings: full CRUD on own settings
create policy "Users can read own settings"
  on public.user_settings for select
  using (auth.uid() = user_id);

create policy "Users can insert own settings"
  on public.user_settings for insert
  with check (auth.uid() = user_id);

create policy "Users can update own settings"
  on public.user_settings for update
  using (auth.uid() = user_id);

create policy "Users can delete own settings"
  on public.user_settings for delete
  using (auth.uid() = user_id);

-- playlists: full CRUD on own playlists
create policy "Users can view own playlists"
  on public.playlists for select
  using (auth.uid() = user_id);

create policy "Users can insert own playlists"
  on public.playlists for insert
  with check (auth.uid() = user_id);

create policy "Users can update own playlists"
  on public.playlists for update
  using (auth.uid() = user_id);

create policy "Users can delete own playlists"
  on public.playlists for delete
  using (auth.uid() = user_id);

-- playlist_tracks: full CRUD on own tracks
create policy "Users can view own playlist tracks"
  on public.playlist_tracks for select
  using (auth.uid() = user_id);

create policy "Users can insert own playlist tracks"
  on public.playlist_tracks for insert
  with check (auth.uid() = user_id);

create policy "Users can update own playlist tracks"
  on public.playlist_tracks for update
  using (auth.uid() = user_id);

create policy "Users can delete own playlist tracks"
  on public.playlist_tracks for delete
  using (auth.uid() = user_id);

-- liked_songs: full CRUD on own likes
create policy "Users can view own liked songs"
  on public.liked_songs for select
  using (auth.uid() = user_id);

create policy "Users can insert own liked songs"
  on public.liked_songs for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own liked songs"
  on public.liked_songs for delete
  using (auth.uid() = user_id);

-- ============================================================
-- Realtime: enable for live sync across devices
-- ============================================================
alter publication supabase_realtime add table public.playlists;
alter publication supabase_realtime add table public.playlist_tracks;
alter publication supabase_realtime add table public.liked_songs;
