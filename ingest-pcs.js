require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const POINTS = [
  100, 80, 60, 50, 45, 40, 36, 32, 29, 26,
  24, 22, 20, 18, 16, 15, 14, 13, 12, 11,
  10, 9, 8, 7, 6, 5, 4, 3, 2, 1
];

function riderKey(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  const stage = Number(process.argv[2]);

  if (!Number.isInteger(stage) || stage < 1 || stage > 21) {
    console.error("Usage: node ingest-pcs.js <stage>");
    console.error("Example: node ingest-pcs.js 4");
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env"
    );
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceRoleKey);

  // ------------------------------------------------------------
  // 1. Download RaceCenter classification
  // ------------------------------------------------------------

  const rankingUrl =
    `https://racecenter.lavuelta.es/api/rankingType-2026-${stage}`;

  console.log(`\nFetching RaceCenter Stage ${stage}...`);
  console.log(rankingUrl);

  const rankingResponse = await fetch(rankingUrl);

  if (!rankingResponse.ok) {
    throw new Error(
      `RaceCenter returned HTTP ${rankingResponse.status}`
    );
  }

  const rankingData = await rankingResponse.json();

  console.log(`✓ Received ${rankingData.length} ranking records`);

  // ------------------------------------------------------------
  // 2. Find the final individual stage classification
  // ------------------------------------------------------------

  const finalClassifications = rankingData
    .filter(
      (item) =>
        item.type === "ite" &&
        Array.isArray(item.rankings) &&
        item.rankings.length >= 30
    )
    .sort((a, b) => {
      const checkpointA = Number(a.checkpoint || 0);
      const checkpointB = Number(b.checkpoint || 0);
      return checkpointB - checkpointA;
    });

  if (finalClassifications.length === 0) {
    console.error(
      "\nNo final stage classification with at least 30 riders was found."
    );
    console.error(
      "The stage may not be finished/published yet."
    );
    process.exit(1);
  }

  const finalClassification = finalClassifications[0];

  console.log(
    `✓ Final classification found: checkpoint ${finalClassification.checkpoint}`
  );

  // ------------------------------------------------------------
  // 3. Download rider/competitor data
  // ------------------------------------------------------------

  const competitorsUrl =
    "https://racecenter.lavuelta.es/api/allCompetitors-2026";

  console.log("\nFetching rider data...");

  const competitorsResponse = await fetch(competitorsUrl);

  if (!competitorsResponse.ok) {
    throw new Error(
      `RaceCenter competitors returned HTTP ${competitorsResponse.status}`
    );
  }

  const competitors = await competitorsResponse.json();

  console.log(`✓ Received ${competitors.length} competitors`);

  // ------------------------------------------------------------
  // 4. Create bib → rider lookup
  // ------------------------------------------------------------

  const ridersByBib = new Map();

  for (const competitor of competitors) {
    if (competitor.bib == null) continue;

    
const name = [
  competitor.lastname,
  competitor.firstname
  ]
      .filter(Boolean)
      .join(" ")
      .trim();

    if (!name) continue;

    ridersByBib.set(Number(competitor.bib), {
      name,
      key: riderKey(name),
      bib: Number(competitor.bib)
    });
  }

  // ------------------------------------------------------------
  // 5. Extract positions 1–30
  // ------------------------------------------------------------

  const results = finalClassification.rankings
    .filter(
      (ranking) =>
        Number.isInteger(ranking.position) &&
        ranking.position >= 1 &&
        ranking.position <= 30
    )
    .sort((a, b) => a.position - b.position);

  if (results.length < 30) {
    console.error(
      `\nOnly found ${results.length} positions in the final classification.`
    );
    console.error("Nothing will be written to Supabase.");
    process.exit(1);
  }

  // ------------------------------------------------------------
  // 6. Resolve riders by bib
  // ------------------------------------------------------------

  const riders = [];

  for (const result of results) {
    const rider = ridersByBib.get(Number(result.bib));

    if (!rider) {
      console.error(
        `Could not find rider for bib ${result.bib} at position ${result.position}`
      );
      process.exit(1);
    }

    riders.push({
      position: result.position,
      bib: rider.bib,
      name: rider.name,
      key: rider.key,
      points: POINTS[result.position - 1]
    });
  }

  // ------------------------------------------------------------
  // 7. Display results BEFORE touching Supabase
  // ------------------------------------------------------------

  console.log("\nFINAL STAGE RESULTS");
  console.log("-------------------");

  for (const rider of riders) {
    console.log(
      `${String(rider.position).padStart(2, " ")}. ` +
      `${rider.name.padEnd(30)} ` +
      `bib ${String(rider.bib).padStart(3)} ` +
      `${rider.points} pts`
    );
  }

  console.log("\n✓ 30 riders successfully resolved");

  // ------------------------------------------------------------
  // 8. Find the existing stage
  // ------------------------------------------------------------

  console.log("\nConnecting to Supabase...");

  const { data: stageRow, error: stageError } = await db
    .from("stages")
    .select("id, stage_number")
    .eq("stage_number", stage)
    .single();

  if (stageError) {
    throw new Error(
      `Could not find Stage ${stage} in Supabase: ${stageError.message}`
    );
  }

  console.log(`✓ Found Supabase Stage ${stage}`);

  // ------------------------------------------------------------
  // 9. Delete existing results for this stage
  // ------------------------------------------------------------

  console.log("Removing previous results...");

  const { error: clearError } = await db
    .from("stage_results")
    .delete()
    .eq("stage_id", stageRow.id);

  if (clearError) {
    throw new Error(
      `Could not clear existing results: ${clearError.message}`
    );
  }

  // ------------------------------------------------------------
  // 10. Insert new results
  // ------------------------------------------------------------

  const rows = riders.map((rider) => ({
    stage_id: stageRow.id,
    finish_position: rider.position,
    rider_key: rider.key,
    rider_name: rider.name,
    points: rider.points
  }));

  const { error: insertError } = await db
    .from("stage_results")
    .insert(rows);

  if (insertError) {
    throw new Error(
      `Could not insert stage results: ${insertError.message}`
    );
  }

  console.log("✓ 30 results inserted");

  // ------------------------------------------------------------
  // 11. Mark stage as published
  // ------------------------------------------------------------

  const { error: updateError } = await db
    .from("stages")
    .update({
      pcs_url:
        `https://racecenter.lavuelta.es/en/rankings/${stage}`,
      status: "published",
      imported_at: new Date().toISOString()
    })
    .eq("id", stageRow.id);

  if (updateError) {
    throw new Error(
      `Results inserted, but stage update failed: ${updateError.message}`
    );
  }

  console.log("✓ Stage marked as published");

  console.log("\n================================");
  console.log(`✓ STAGE ${stage} IMPORT COMPLETE`);
  console.log("================================");
  console.log(`✓ ${riders.length} riders`);
  console.log("✓ Results written to Supabase");
  console.log("✓ Previous stage results replaced");
  console.log("");
}

main().catch((error) => {
  console.error("\nERROR:");
  console.error(error.message);
  process.exit(1);
});
