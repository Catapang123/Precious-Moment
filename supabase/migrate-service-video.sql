-- Precious Moments — optional booth preview videos
-- Run once in the Supabase SQL editor. Safe to run more than once. This only
-- adds nullable/empty media columns to pm_services; existing products, prices,
-- images, accounts, bookings, and storage objects are untouched.

alter table public.pm_services
  add column if not exists video_url text not null default '',
  add column if not exists video_mime text not null default '',
  add column if not exists video_bytes bigint,
  add column if not exists video_updated_at timestamptz,
  add column if not exists video_updated_by text;

-- The public media bucket already serves product images. Videos use the
-- `videos/` prefix in that same bucket and are uploaded only by the Node server
-- with the service-role key; no browser storage policy is added.
--
-- The bucket was originally created for 4 MB images only. Videos need the
-- larger object limit and their own MIME types, or Storage rejects every upload
-- before the app can record it.
update storage.buckets
set
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'],
  file_size_limit = 26214400,
  updated_at = now()
where id = 'product-images';
