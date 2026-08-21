import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const fantasyProsApiKey = Deno.env.get("FANTASYPROS_API_KEY");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const cronSecret = Deno.env.get("CRON_SECRET");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!fantasyProsApiKey || !supabaseUrl || !serviceRoleKey || !cronSecret) {
    return json({ error: "Required Edge Function secrets are not configured." }, 500);
  }

  if (request.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "Unauthorized." }, 401);
  }

  try {
    const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    const season = Number(body.season ?? new Date().getUTCFullYear());
    const format = String(body.format ?? "redraft");
    const scoring = String(body.scoring ?? "HALF").toUpperCase();
    const requestedPosition = String(body.position ?? "all").toUpperCase();
    const positions = requestedPosition === "ALL"
      ? ["QB", "RB", "WR", "TE", "K", "DST"]
      : [requestedPosition];
    const rankingResults = await Promise.all(positions.map((position) => fetchRankings({
      apiKey: fantasyProsApiKey,
      season,
      format,
      scoring,
      position,
    })));
    const rows = rankingResults.flatMap(({ rankings, position }) => rankings
      .map((ranking: Record<string, unknown>) => ({
        season,
        format,
        scoring,
        position,
        player_name: String(ranking.player_name ?? ranking.name ?? "").trim(),
        rank_ecr: integerOrNull(ranking.rank_ecr ?? ranking.ecr),
        rank_adp: numberOrNull(ranking.rank_adp ?? ranking.adp),
        payload: ranking,
        fetched_at: new Date().toISOString(),
      }))
      .filter((row: { player_name: string }) => row.player_name.length > 0));

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase
      .from("fantasypros_rankings")
      .upsert(rows, { onConflict: "season,format,scoring,position,player_name" });

    if (error) throw error;
    return json({ synced: rows.length, season, format, scoring, position: requestedPosition });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected sync failure." }, 500);
  }
});

function integerOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

async function fetchRankings({
  apiKey,
  season,
  format,
  scoring,
  position,
}: {
  apiKey: string;
  season: number;
  format: string;
  scoring: string;
  position: string;
}) {
  const url = new URL(`https://api.fantasypros.com/public/v2/json/nfl/${season}/consensus-rankings`);
  url.searchParams.set("format", format);
  url.searchParams.set("scoring", scoring);
  url.searchParams.set("position", position);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "x-api-key": apiKey,
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`FantasyPros ${position} request failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  const rankings = Array.isArray(payload) ? payload : payload.rankings ?? payload.players ?? [];
  if (!Array.isArray(rankings)) {
    throw new Error(`Unexpected FantasyPros ${position} response shape.`);
  }

  return { rankings, position };
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
