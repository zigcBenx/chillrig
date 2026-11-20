-- Newer Supabase projects no longer grant table privileges to API roles by default.
-- The control plane talks to PostgREST with the service role, so grant it explicitly.
-- Signed-in users keep read-only access to their own rows through the RLS policies in 0001.
grant usage on schema public to service_role, authenticated;
grant select, insert, update, delete on table public.profiles, public.subscriptions, public.boxes, public.stripe_events to service_role;
grant select on table public.profiles, public.subscriptions, public.boxes to authenticated
