import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const POINTS = [
  100, 80, 60, 50, 45, 40, 36, 32, 29, 26,
  24, 22, 20, 18, 16, 15, 14, 13, 12, 11,
  10, 9, 8, 7, 6, 5, 4, 3, 2, 1
];

const cors = {
  "content-type": "application/json",
};

// PCS does not provide a public results API.
// This importer only accepts a complete official top-30 classification.
// If PCS has no classification, a partial classification, DNF-only data,
// or a cancelled/unfinished stage, nothing is written to the database.

function decode(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
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

function parseTopThirty(html: string) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

  const riders: {
    position: number;
    key: string;
    name: string;
  }[] = [];

  for (const row of rows) {
    const body = row[1];

    // PCS presents surname and first name as separate links
    // with the same rider URL.
    const riderLinks = [
      ...body.matchAll(
        /href=["'](?:https?:\/\/[^"']+)?\/?rider\/([^"'?/#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi
      ),
    ];

    const rider = riderLinks[0];

    const cells = [
      ...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi),
    ].map((x) => decode(x[1]));

    const rankCell = cells.find((x) => /^\d{1,2}\.?$/.test(x));

    if (!rankCell || !rider) {
      continue;
    }

    const position = Number(rankCell.replace(".", ""));

    if (position < 1 || position > 30) {
      continue;
    }

    const name = riderLinks
      .filter((link) => link[1] === rider[1])
      .map((link) => decode(link[2]))
      .filter(Boolean)
      .join(" ");

    if (!name) {
      continue;
    }

    riders.push({
      position,
      key: riderKey(name),
      name,
    });
  }

  // Remove duplicate positions.
  const uniqueRiders = riders
    .filter(
      (r, i, all) =>
        all.findIndex((x) => x.position === r.position) === i
    )
    .sort((a, b) => a.position - b.position)
    .slice(0, 30);

  return uniqueRiders;
}

function isCompleteTopThirty(
  riders: { position: number; key: string; name: string }[]
) {
  if (riders.length !== 30) {
    return false;
  }

  for (let i = 0; i < 30; i++) {
    if (riders[i].position !== i + 1) {
      return false;
    }
  }

  return true;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "POST required" }),
        { status: 405, headers: cors }
      );
    }

    // Protect the importer with the server-side secret.
    if (
      req.headers.get("x-ingest-secret") !==
      Deno.env.get("INGEST_SECRET")
    ) {
      return new Response(
        JSON.stringify({ error: "unauthorized" }),
        { status: 401, headers: cors }
      );
    }

    const { stage } = await req.json();

    if (
      !Number.isInteger(stage) ||
      stage < 1 ||
      stage > 21
    ) {
      return new Response(
        JSON.stringify({ error: "stage must be 1–21" }),
        { status: 400, headers: cors }
      );
    }

    const url =
      `https://www.procyclingstats.com/race/vuelta-a-espana/2026/stage-${stage}/result/result`;

    const response = await fetch(url, {
      headers: {
        "user-agent": "VueltaFantasy results importer/1.0",
      },
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          stage,
          imported: false,
          status: "pcs_error",
          reason: `PCS returned ${response.status}`,
        }),
        { status: 502, headers: cors }
      );
    }

    const html = await response.text();

    const riders = parseTopThirty(html);

    // IMPORTANT:
    // Never publish a partial, empty, cancelled, or DNF-only result.
    if (!isCompleteTopThirty(riders)) {
      return new Response(
        JSON.stringify({
          stage,
          imported: false,
          status: "pending",
          reason: "No complete official top-30 classification found",
          riders_found: riders.length,
        }),
        { status: 200, headers: cors }
      );
    }

    // Only create the database client after we know that
    // PCS contains a complete official top-30 result.
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: stageRow, error: stageError } =
      await db
        .from("stages")
        .upsert(
          {
            stage_number: stage,
            pcs_url: url,
            status: "published",
            imported_at: new Date().toISOString(),
          },
          {
            onConflict: "stage_number",
          }
        )
        .select("id")
        .single();

    if (stageError) {
      throw stageError;
    }

    // Clear any previous result only AFTER a complete official
    // classification has been confirmed.
    const { error: clearError } =
      await db
        .from("stage_results")
        .delete()
        .eq("stage_id", stageRow.id);

    if (clearError) {
      throw clearError;
    }

    const { error: resultError } =
      await db
        .from("stage_results")
        .insert(
          riders.map((r) => ({
            stage_id: stageRow.id,
            finish_position: r.position,
            rider_key: r.key,
            rider_name: r.name,
            points: POINTS[r.position - 1],
          }))
        );

    if (resultError) {
      throw resultError;
    }

    return new Response(
      JSON.stringify({
        stage,
        imported: true,
        status: "published",
        riders: riders.length,
      }),
      { status: 200, headers: cors }
    );
  } catch (error) {
    console.error(error);

    return new Response(
      JSON.stringify({
        error: "Internal importer error",
        message: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: cors }
    );
  }
});
