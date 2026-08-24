import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const POINTS = [
  100, 80, 60, 50, 45, 40, 36, 32, 29, 26,
  24, 22, 20, 18, 16, 15, 14, 13, 12, 11,
  10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
];

const headers = {
  "content-type": "application/json",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

function decode(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function riderKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function isBlockedOrChallenge(html: string) {
  const lower = html.toLowerCase();

  return (
    lower.includes("<title>just a moment...</title>") ||
    lower.includes("challenge-platform") ||
    lower.includes("enable javascript and cookies to continue") ||
    lower.includes("cf-chl-") ||
    lower.includes("cloudflare")
  );
}

function looksLikePcsResultsPage(html: string) {
  const lower = html.toLowerCase();

  return (
    lower.includes("procyclingstats") &&
    lower.includes("rnk") &&
    lower.includes("rider")
  );
}

/**
 * PCS labels a cancelled stage with wording such as:
 * “Race/stage is cancelled.”
 * “Stage 3 was cancelled due to extreme weather conditions…”
 */
function isCancelledStage(html: string) {
  const text = decode(html).toLowerCase();

  return (
    text.includes("race/stage is cancelled") ||
    /\bstage\s+\d+\s+was\s+cancelled\b/.test(text) ||
    text.includes("stage was cancelled")
  );
}

function extractRiderName(body: string) {
  const riderLinks = [
    ...body.matchAll(
      /href=["'](?:https?:\/\/[^"']+)?\/?rider\/([^"'?/#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi,
    ),
  ];

  if (riderLinks.length === 0) return null;

  const riderId = riderLinks[0][1];
  const parts = riderLinks
    .filter((link) => link[1] === riderId)
    .map((link) => decode(link[2]))
    .filter(Boolean);

  return parts.length ? parts.join(" ") : null;
}

function parseTopThirty(html: string) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

  const riders: {
    position: number;
    key: string;
    name: string;
  }[] = [];

  for (const row of rows) {
    const body = row[1];

    const cells = [
      ...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi),
    ].map((match) => decode(match[1]));

    if (!cells.length) continue;

    const rankText = cells[0].replace(/\./g, "").trim();

    // NR, DNF, DNS, DSQ, etc. must never receive points.
    if (!/^\d+$/.test(rankText)) continue;

    const position = Number(rankText);
    if (position < 1 || position > 30) continue;

    const name = extractRiderName(body);
    if (!name) continue;

    riders.push({
      position,
      key: riderKey(name),
      name,
    });
  }

  return riders
    .filter(
      (rider, index, all) =>
        all.findIndex((candidate) => candidate.position === rider.position) ===
        index,
    )
    .sort((a, b) => a.position - b.position);
}

function isCompleteTopThirty(
  riders: { position: number; key: string; name: string }[],
) {
  if (riders.length !== 30) return false;

  return riders.every(
    (rider, index) =>
      rider.position === index + 1 &&
      Boolean(rider.key) &&
      Boolean(rider.name),
  );
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return json({ error: "POST required" }, 405);
    }

    const ingestSecret = Deno.env.get("INGEST_SECRET");

    if (
      !ingestSecret ||
      req.headers.get("x-ingest-secret") !== ingestSecret
    ) {
      return json({ error: "unauthorized" }, 401);
    }

    const body = await req.json();
    const stage = body?.stage;

    if (!Number.isInteger(stage) || stage < 1 || stage > 21) {
      return json({ error: "stage must be 1–21" }, 400);
    }

    const pcsUrl =
      `https://www.procyclingstats.com/race/vuelta-a-espana/2026/stage-${stage}/result/result`;

    const response = await fetch(pcsUrl, {
      headers: {
        "user-agent": "VueltaFantasy results importer/1.0",
        accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      return json(
        {
          stage,
          imported: false,
          status: "pcs_error",
          reason: `PCS returned HTTP ${response.status}`,
        },
        502,
      );
    }

    const html = await response.text();

    if (isBlockedOrChallenge(html)) {
      return json({
        stage,
        imported: false,
        status: "pcs_blocked",
        reason: "PCS returned a Cloudflare challenge; no data was imported.",
      });
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // A cancelled stage receives no score and closes predictions.
    if (isCancelledStage(html)) {
      const { data: stageRow, error: stageError } = await db
        .from("stages")
        .upsert(
          {
            stage_number: stage,
            pcs_url: pcsUrl,
            status: "cancelled",
            imported_at: new Date().toISOString(),
          },
          { onConflict: "stage_number" },
        )
        .select("id")
        .single();

      if (stageError) throw stageError;

      const { error: clearError } = await db
        .from("stage_results")
        .delete()
        .eq("stage_id", stageRow.id);

      if (clearError) throw clearError;

      return json({
        stage,
        imported: false,
        status: "cancelled",
        reason: "Stage was cancelled; no points were awarded.",
      });
    }

    if (!looksLikePcsResultsPage(html)) {
      return json({
        stage,
        imported: false,
        status: "invalid_pcs_page",
        reason: "Response did not contain the expected PCS results page.",
      });
    }

    const riders = parseTopThirty(html);

    if (!isCompleteTopThirty(riders)) {
      return json({
        stage,
        imported: false,
        status: "pending",
        reason: "No complete official top-30 classification found.",
        riders_found: riders.length,
      });
    }

    const { data: stageRow, error: stageError } = await db
      .from("stages")
      .upsert(
        {
          stage_number: stage,
          pcs_url: pcsUrl,
          status: "published",
          imported_at: new Date().toISOString(),
        },
        { onConflict: "stage_number" },
      )
      .select("id")
      .single();

    if (stageError) throw stageError;

    const { error: clearError } = await db
      .from("stage_results")
      .delete()
      .eq("stage_id", stageRow.id);

    if (clearError) throw clearError;

    const results = riders.map((rider) => ({
      stage_id: stageRow.id,
      finish_position: rider.position,
      rider_key: rider.key,
      rider_name: rider.name,
      points: POINTS[rider.position - 1],
    }));

    const { error: resultError } = await db
      .from("stage_results")
      .insert(results);

    if (resultError) throw resultError;

    return json({
      stage,
      imported: true,
      status: "published",
      riders: riders.length,
    });
  } catch (error) {
    console.error(error);

    return json(
      {
        error: "Internal importer error",
        message: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
