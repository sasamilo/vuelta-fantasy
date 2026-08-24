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
//
// This importer only accepts a COMPLETE official top-30
// classification.
//
// IMPORTANT:
// - The first <td> in a PCS result row is the result/rank.
// - A numeric value (1, 2, 3...) means a finishing position.
// - Values such as NR, DNF, DNS, DSQ, OTL, etc. are NOT
//   finishing positions.
// - Bib numbers and other numeric cells later in the row
//   must NEVER be interpreted as finishing positions.
//
// If PCS has no complete official top-30 classification,
// nothing is written to the database.

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
  const rows = [
    ...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)
  ];

  const riders: {
    position: number;
    key: string;
    name: string;
  }[] = [];

  for (const row of rows) {
    const body = row[1];

    // Extract table cells in their original order.
    const cells = [
      ...body.matchAll(
        /<td[^>]*>([\s\S]*?)<\/td>/gi
      ),
    ].map((x) => decode(x[1]));

    // A valid PCS result row must have a first cell.
    if (cells.length === 0) {
      continue;
    }

    // IMPORTANT:
    //
    // PCS result columns start with the result/rank column.
    //
    // Example of a normal stage:
    // 1 | ... | BIB | ... | Rider
    // 2 | ... | BIB | ... | Rider
    //
    // Example of a cancelled/no-result stage:
    // NR | ... | BIB | ... | Rider
    //
    // DNF, DNS, NR, DSQ, OTL, etc. are therefore rejected
    // automatically because they are not numeric.
    const rankCell = cells[0].trim();

    if (!/^\d{1,2}$/.test(rankCell)) {
      continue;
    }

    const position = Number(rankCell);

    if (position < 1 || position > 30) {
      continue;
    }

    // Find the rider link.
    //
    // PCS presents the rider's surname and first name as
    // separate links using the same rider URL.
    const riderLinks = [
      ...body.matchAll(
        /href=["'](?:https?:\/\/[^"']+)?\/?rider\/([^"'?/#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi
      ),
    ];

    if (riderLinks.length === 0) {
      continue;
    }

    const rider = riderLinks[0];

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
  //
  // This is important because the PCS HTML can contain
  // multiple representations of the same row.
  return riders
    .filter(
      (r, i, all) =>
        all.findIndex(
          (x) => x.position === r.position
        ) === i
    )
    .sort((a, b) => a.position - b.position)
    .slice(0, 30);
}

function isCompleteTopThirty(
  riders: {
    position: number;
    key: string;
    name: string;
  }[]
) {
  // We require EXACTLY 30 riders.
  if (riders.length !== 30) {
    return false;
  }

  // We require positions 1 through 30 with no gaps.
  for (let i = 0; i < 30; i++) {
    if (riders[i].position !== i + 1) {
      return false;
    }
  }

  return true;
}

Deno.serve(async (req) => {
  try {
    // Only POST requests are accepted.
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({
          error: "POST required"
        }),
        {
          status: 405,
          headers: cors
        }
      );
    }

    // Protect the importer with the server-side secret.
    const suppliedSecret =
      req.headers.get("x-ingest-secret");

    const ingestSecret =
      Deno.env.get("INGEST_SECRET");

    if (
      !ingestSecret ||
      suppliedSecret !== ingestSecret
    ) {
      return new Response(
        JSON.stringify({
          error: "unauthorized"
        }),
        {
          status: 401,
          headers: cors
        }
      );
    }

    const { stage } = await req.json();

    // Only Vuelta stages 1–21 are valid.
    if (
      !Number.isInteger(stage) ||
      stage < 1 ||
      stage > 21
    ) {
      return new Response(
        JSON.stringify({
          error: "stage must be 1–21"
        }),
        {
          status: 400,
          headers: cors
        }
      );
    }

    const url =
      `https://www.procyclingstats.com/race/vuelta-a-espana/2026/stage-${stage}/result/result`;

    const response = await fetch(url, {
      headers: {
        "user-agent":
          "VueltaFantasy results importer/1.0"
      }
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          stage,
          imported: false,
          status: "pcs_error",
          reason:
            `PCS returned ${response.status}`
        }),
        {
          status: 502,
          headers: cors
        }
      );
    }

    const html = await response.text();

    const riders = parseTopThirty(html);

    // ---------------------------------------------------------
    // CRITICAL SAFETY CHECK
    // ---------------------------------------------------------
    //
    // If PCS shows:
    // - NR
    // - DNF
    // - DNS
    // - DSQ
    // - OTL
    // - cancelled stage
    // - partial classification
    // - malformed data
    //
    // then riders will NOT contain a complete 1–30 result.
    //
    // In that situation we return WITHOUT touching Supabase.
    // ---------------------------------------------------------

    if (!isCompleteTopThirty(riders)) {
      return new Response(
        JSON.stringify({
          stage,
          imported: false,
          status: "pending",
          reason:
            "No complete official top-30 classification found",
          riders_found: riders.length
        }),
        {
          status: 200,
          headers: cors
        }
      );
    }

    // Only create the database client after we have
    // confirmed a complete official top-30.
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY"
      )!
    );

    // Mark the stage as published.
    const {
      data: stageRow,
      error: stageError
    } = await db
      .from("stages")
      .upsert(
        {
          stage_number: stage,
          pcs_url: url,
          status: "published",
          imported_at:
            new Date().toISOString()
        },
        {
          onConflict: "stage_number"
        }
      )
      .select("id")
      .single();

    if (stageError) {
      throw stageError;
    }

    // Only delete previous results AFTER a complete
    // official classification has been confirmed.
    //
    // This means a cancelled or unfinished stage can
    // NEVER accidentally delete valid existing data.
    const {
      error: clearError
    } = await db
      .from("stage_results")
      .delete()
      .eq("stage_id", stageRow.id);

    if (clearError) {
      throw clearError;
    }

    // Insert the official top 30.
    const {
      error: resultError
    } = await db
      .from("stage_results")
      .insert(
        riders.map((r) => ({
          stage_id: stageRow.id,
          finish_position: r.position,
          rider_key: r.key,
          rider_name: r.name,
          points: POINTS[r.position - 1]
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
        riders: riders.length
      }),
      {
        status: 200,
        headers: cors
      }
    );
  } catch (error) {
    console.error(error);

    return new Response(
      JSON.stringify({
        error: "Internal importer error",
        message:
          error instanceof Error
            ? error.message
            : String(error)
      }),
      {
        status: 500,
        headers: cors
      }
    );
  }
});
