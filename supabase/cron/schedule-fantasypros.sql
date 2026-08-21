-- Run this in the Supabase SQL Editor after replacing the placeholders.
-- The Edge Function must already be deployed as `sync-fantasypros` with JWT
-- verification disabled; it validates CRON_SECRET itself.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'sync-fantasypros-daily',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://ngwmnfkaviwazamlzpbo.supabase.co/functions/v1/sync-fantasypros',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_CRON_SECRET'
    ),
    body := jsonb_build_object(
      'season', 2026,
      'format', 'redraft',
      'scoring', 'HALF',
      'position', 'ALL'
    )
  );
  $$
);

-- Check the scheduled job:
-- select jobid, jobname, schedule, active from cron.job;

-- Check recent HTTP invocation results:
-- select * from net._http_response order by created desc limit 10;
