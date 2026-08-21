# Sunday League

An Expo React Native fantasy football draft board with a Supabase-ready data layer.

## Run locally

```bash
npm install
npx expo start
```

The first screen is intentionally usable without a backend: the player pool and draft picks are local sample data. Copy `.env.example` to `.env` and add your Supabase project values when you are ready to persist leagues, players, and picks.

## Authentication

After adding the Supabase values, enable email authentication in the Supabase dashboard under Authentication > Providers. The app supports email/password sign-in and account creation, and persists the session on the device. Email confirmation behavior follows the setting in the Supabase dashboard.

## Supabase path

`lib/supabase.ts` creates the client only when `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are available. The mobile app should use the public anonymous key for normal authenticated requests; privileged sports-data and AI calls belong in Supabase Edge Functions.

Planned tables for the next slice:

- `leagues`: league name, season, draft status, and commissioner
- `players`: player metadata, position, team, rank, and average draft position
- `draft_picks`: league, pick number, roster owner, and player

## FantasyPros sync

The first backend slice is in `supabase/`. Run `supabase/migrations/20260820200000_create_fantasypros_rankings.sql` in the Supabase SQL Editor, then set the `FANTASYPROS_API_KEY` and a strong random `CRON_SECRET` with `supabase secrets set FANTASYPROS_API_KEY=... CRON_SECRET=...`. Deploy `supabase/functions/sync-fantasypros/index.ts` as the `sync-fantasypros` Edge Function with `supabase functions deploy sync-fantasypros --no-verify-jwt`; the function uses Supabase's built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets. Do not add those values to the Expo app.

After deployment, invoke it once manually with a JSON body such as:

```json
{"season":2026,"format":"redraft","scoring":"HALF","position":"all"}
```

Confirm the response shape and row count before scheduling a daily Cron job. The 50-request daily limit makes a single daily all-player sync the default starting schedule.

The player pool now reads the cached `fantasypros_rankings` rows for 2026 redraft HALF-PPR after login. It does not call FantasyPros from the phone.

To schedule the daily refresh, open `supabase/cron/schedule-fantasypros.sql`, replace `YOUR_CRON_SECRET`, and run it in the Supabase SQL Editor. It schedules the sync for 06:00 UTC. Check `cron.job` and `net._http_response` there to confirm the job and its responses.
