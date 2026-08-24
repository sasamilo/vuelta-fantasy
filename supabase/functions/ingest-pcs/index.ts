import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const POINTS = [
  100, 80, 60, 50, 45, 40, 36, 32, 29, 26,
  24, 22, 20, 18, 16, 15, 14, 13, 12, 11,
  10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
];

const cors = {
  "content-type": "application/json",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors,
  });
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

/**
 * Detect pages that are NOT the PCS results page.
 *
 * In particular, Cloudflare may return HTTP 200 with a
 * "Just a moment..." challenge. HTTP status alone is therefore
 * not sufficient to determine whether the page is usable.
 */
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

/**
 * Make sure this actually looks like a PCS results page
 * before attempting to parse it.
 */
function looksLikePcsResultsPage(html: string) {
  const lower = html.toLowerCase();

  return (
    lower.includes("procyclingstats") &&
    lower.includes("rnk") &&
    lower.includes("rider")
  );
}

/**
 * Extract a rider's name from PCS rider links.
 *
 * PCS commonly represents surname and first name as separate
 * links pointing to the same rider URL.
 */
function extractRiderName(body: string) {
  const riderLinks = [
    ...body.matchAll(
      /href=["'](?:https?:\/\/[^"']+)?\/?rider\/([^"'?/#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi
    ),
  ];

  if (riderLinks.length === 0) {
    return null;
  }

  const riderId = riderLinks[0][1];

  const parts = riderLinks
    .filter((link) => link[1] === riderId)
    .map((link) => decode(link[2]))
    .filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  return parts.join(" ");
}

/**
 * Parse only rows whose FIRST table cell is an actual numeric rank.
 *
 * IMPORTANT:
 * This function deliberately does NOT accept:
 * NR
 * DNF
 * DNS
 * DSQ
 * etc.
 *
 * It also does not treat arbitrary numeric cells such as BIB,
 * age, UCI points, etc. as finishing positions.
 */
function parseTopThirty(html: string) {
  const rows = [
    ...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi),
  ];

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

    if (cells.length === 0) {
      continue;
    }

    /*
     * On a PCS results table the Rnk column is the first
     * data column. Only accept a plain integer 1–30 here.
     */
    const rankText = cells[0]
      .replace(/\./g, "")
      .trim();

    if (!/^\d+$/.test(rankText)) {
      continue;
    }

    const position = Number(rankText);

    if (position < 1 || position > 30) {
      continue;
    }

    const name = extractRiderName(body);

    if (!name) {
      continue;
    }

    riders.push({
      position,
      key: riderKey(name),
      name,
    });
  }

  /*
   * There can be multiple tables on a PCS page.
   *
   * Keep only one rider per position.
   */
  const unique = riders
    .filter(
      (r, index, all) =>
        all.findIndex(
          (x) => x.position === r.position
        ) === index
    )
    .sort((a, b) => a.position - b.position);

  return unique;
}

/**
 * Absolutely require a complete 1–30 classification.
 */
function isCompleteTopThirty(
  riders: {
    position: number;
    key: string;
    name: string;
  }[],
) {
  if (riders.length !== 30) {
    return false;
  }

  for (let i = 0; i < 30; i++) {
    if (riders[i].position !== i + 1) {
      return false;
    }

    if (!riders[i].key || !riders[i].name) {
      return false;
    }
  }

  return true;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return json(
        { error: "POST required" },
        405,
      );
    }

    const ingestSecret =
      Deno.env.get("INGEST_SECRET");

    if (
      !ingestSecret ||
      req.headers.get("x-ingest-secret") !== ingestSecret
    ) {
      return json(
        { error: "unauthorized" },
        401,
      );
    }

    const body = await req.json();
    const stage = body?.stage;

    if (
      !Number.isInteger(stage) ||
      stage < 1 ||
      stage > 21
    ) {
      return json(
        { error: "stage must be 1–21" },
        400,
      );
    }

    const url =
      `https://www.procyclingstats.com/race/vuelta-a-espana/2026/stage-${stage}/result/result`;

    const response = await fetch(url, {
      headers: {
        "user-agent":
          "VueltaFantasy results importer/1.0",
        "accept":
          "text/html,application/xhtml+xml",
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

    /*
     * CRITICAL SAFETY CHECK:
     *
     * Cloudflare challenges can return HTTP 200.
     * Therefore response.ok is NOT enough.
     */
    if (isBlockedOrChallenge(html)) {
      console.error(
        `PCS returned a Cloudflare challenge for stage ${stage}`,
      );

      return json({
        stage,
        imported: false,
        status: "pcs_blocked",
        reason:
          "PCS returned a Cloudflare challenge; no data was imported",
      });
    }

    /*
     * Don't attempt to parse arbitrary HTML.
     */
    if (!looksLikePcsResultsPage(html)) {
      console.error(
        `Response for stage ${stage} does not look like a PCS results page`,
      );

      return json({
        stage,
        imported: false,
        status: "invalid_pcs_page",
        reason:
          "Response did not contain the expected PCS results page",
      });
    }

    const riders = parseTopThirty(html);

    /*
     * FAIL CLOSED.
     *
     * Nothing is written unless we have exactly:
     *
     * 1, 2, 3 ... 30
     */
    if (!isCompleteTopThirty(riders)) {
      console.error(
        `Incomplete classification for stage ${stage}: ${riders.length} riders`,
      );

      return json({
        stage,
        imported: false,
        status: "pending",
        reason:
          "No complete official top-30 classification found",
        riders_found: riders.length,
      });
    }

    /*
     * Only now do we create the database client.
     *
     * No database writes happen before all validation
     * checks above have passed.
     */
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: stageRow, error: stageError } =
      await db
        .from("stages")
        .upsert(
          {
            stage_number: stage,
            pcs_url: url,
            status: "published",
            imported_at:
              new Date().toISOString(),
          },
          {
            onConflict: "stage_number",
          },
        )
        .select("id")
        .single();

    if (stageError) {
      throw stageError;
    }

    /*
     * Delete existing results ONLY after we have
     * successfully validated a complete new result.
     */
    const { error: clearError } =
      await db
        .from("stage_results")
        .delete()
        .eq("stage_id", stageRow.id);

    if (clearError) {
      throw clearError;
    }

    const results = riders.map((r) => ({
      stage_id: stageRow.id,
      finish_position: r.position,
      rider_key: r.key,
      rider_name: r.name,
      points: POINTS[r.position - 1],
    }));

    const { error: resultError } =
      await db
        .from("stage_results")
        .insert(results);

    if (resultError) {
      throw resultError;
    }

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
        message:
          error instanceof Error
            ? error.message
            : String(error),
      },
      500,
    );
  }
});
