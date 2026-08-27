require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const POINTS = [
  100, 80, 60, 50, 45, 40, 36, 32, 29, 26,
  24, 22, 20, 18, 16, 15, 14, 13, 12, 11,
  10, 9, 8, 7, 6, 5, 4, 3, 2, 1
];

const RACE_YEAR = 2026;
const RACE_CENTER_BASE = "https://racecenter.lavuelta.es/api";

function riderKey(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rankings)) return value.rankings;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.results)) return value.results;
  return [];
}

async function fetchJson(url, label) {
  console.log(`\nFetching ${label}...`);
  console.log(url);

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 Vuelta-Fantasy/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }

  const data = await response.json();
  console.log("✓ JSON received");
  return data;
}

async function main() {
  const stage = Number(process.argv[2]);

  if (!Number.isInteger(stage) || stage < 1 || stage > 21) {
    console.error("Usage: node ingest-pcs.js <stage>");
    console.error("Example: node ingest-pcs.js 6");
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceRoleKey);

  const rankingUrl = `${RACE_CENTER_BASE}/rankingType-${RACE_YEAR}-${stage}`;
  const rankingPayload = await fetchJson(rankingUrl, `RaceCenter Stage ${stage} classification`);
  const rankingData = asArray(rankingPayload);

  if (rankingData.length === 0) {
    throw new Error("RaceCenter returned no ranking records.");
  }

  console.log(`✓ Received ${rankingData.length} ranking records`);

  const finalClassifications = rankingData
    .filter((item) => {
      const type = String(item.type ?? "").toLowerCase();
      const rankings = asArray(item);
      return type === "ite" && rankings.length >= 30;
    })
    .sort((a, b) => {
      const checkpointA = Number(a.checkpoint ?? a.checkPoint ?? 0);
      const checkpointB = Number(b.checkpoint ?? b.checkPoint ?? 0);
      return checkpointB - checkpointA;
    });

  if (finalClassifications.length === 0) {
    console.error("\nNo final individual classification with at least 30 riders was found.");
    console.error("The stage may not be finished/published yet.");
    process.exit(1);
  }

  const finalClassification = finalClassifications[0];
  const finalRankings = asArray(finalClassification);

  console.log(
    `✓ Final classification found: checkpoint ${finalClassification.checkpoint ?? finalClassification.checkPoint ?? "unknown"}`
  );

  const competitorsUrl = `${RACE_CENTER_BASE}/allCompetitors-${RACE_YEAR}`;
  const competitorsPayload = await fetchJson(competitorsUrl, "RaceCenter competitor data");
  const competitors = asArray(competitorsPayload);

  if (competitors.length === 0) {
    throw new Error("RaceCenter returned no competitor records.");
  }

  console.log(`✓ Received ${competitors.length} competitors`);

  const ridersByBib = new Map();

  for (const competitor of competitors) {
    if (competitor.bib == null) continue;

    // Store the canonical fantasy/database name as LAST NAME FIRST NAME.
    const name = [competitor.lastname, competitor.firstname]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!name) continue;

    ridersByBib.set(Number(competitor.bib), {
      name,
      key: riderKey(name),
      bib: Number(competitor.bib)
    });
  }

  const results = finalRankings
    .map((ranking) => ({
      ...ranking,
      position: Number(ranking.position ?? ranking.rank ?? ranking.place),
      bib: Number(ranking.bib ?? ranking.bibNumber ?? ranking.competitorBib)
    }))
    .filter(
      (ranking) =>
        Number.isInteger(ranking.position) &&
        ranking.position >= 1 &&
        ranking.position <= 30
    )
    .sort((a, b) => a.position - b.position);

  const uniquePositions = new Set(results.map((result) => result.position));

  if (results.length !== 30 || uniquePositions.size !== 30) {
    console.error(
      `\nExpected exactly 30 unique positions, found ${results.length} rows / ${uniquePositions.size} unique positions.`
    );
    console.error("Nothing will be written to Supabase.");
    process.exit(1);
  }

  const riders = [];

  for (const result of results) {
    const rider = ridersByBib.get(result.bib);

    if (!rider) {
      throw new Error(
        `Could not resolve rider for bib ${result.bib} at position ${result.position}. Nothing will be written.`
      );
    }

    riders.push({
      position: result.position,
      bib: rider.bib,
      name: rider.name,
      key: rider.key,
      points: POINTS[result.position - 1]
    });
  }

  const uniqueBibs = new Set(riders.map((rider) => rider.bib));

  if (uniqueBibs.size !== 30) {
    throw new Error("The top 30 contains duplicate rider bibs. Nothing will be written.");
  }

  console.log("\nFINAL STAGE RESULTS");
  console.log("-------------------");

  for (const rider of riders) {
    console.log(
      `${String(rider.position).padStart(2, " ")}. ` +
      `${rider.name.padEnd(32)} ` +
      `bib ${String(rider.bib).padStart(3)} ` +
      `${rider.points} pts`
    );
  }

  console.log("\n✓ Exactly 30 unique riders successfully resolved");

  console.log("\nConnecting to Supabase...");

  const { data: stageRow, error: stageError } = await db
    .from("stages")
    .select("id, stage_number")
    .eq("stage_number", stage)
    .single();

  if (stageError) {
    throw new Error(`Could not find Stage ${stage} in Supabase: ${stageError.message}`);
  }

  console.log(`✓ Found Supabase Stage ${stage}`);

  console.log("Removing previous results for this stage...");

  const { error: clearError } = await db
    .from("stage_results")
    .delete()
    .eq("stage_id", stageRow.id);

  if (clearError) {
    throw new Error(`Could not clear existing results: ${clearError.message}`);
  }

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
    throw new Error(`Could not insert stage results: ${insertError.message}`);
  }

  console.log("✓ 30 results inserted");

  const { error: updateError } = await db
    .from("stages")
    .update({
      pcs_url: `https://racecenter.lavuelta.es/en/rankings/${stage}`,
      status: "published",
      imported_at: new Date().toISOString()
    })
    .eq("id", stageRow.id);

  if (updateError) {
    throw new Error(`Results inserted, but stage update failed: ${updateError.message}`);
  }

  console.log("✓ Stage marked as published");

  console.log("\n================================");
  console.log(`✓ STAGE ${stage} IMPORT COMPLETE`);
  console.log("================================");
  console.log(`✓ ${riders.length} riders`);
  console.log("✓ Official Race Center source used");
  console.log("✓ Results written to Supabase");
}

main().catch((error) => {
  console.error("\nERROR:");
  console.error(error.message);
  process.exit(1);
});
