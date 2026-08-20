# Sunday League

An Expo React Native fantasy football draft board with a Supabase-ready data layer.

## Run locally

```bash
npm install
npx expo start
```

The first screen is intentionally usable without a backend: the player pool and draft picks are local sample data. Copy `.env.example` to `.env` and add your Supabase project values when you are ready to persist leagues, players, and picks.

## Supabase path

`lib/supabase.ts` creates the client only when `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are available. The mobile app should use the public anonymous key for normal authenticated requests; privileged sports-data and AI calls belong in Supabase Edge Functions.

Planned tables for the next slice:

- `leagues`: league name, season, draft status, and commissioner
- `players`: player metadata, position, team, rank, and average draft position
- `draft_picks`: league, pick number, roster owner, and player