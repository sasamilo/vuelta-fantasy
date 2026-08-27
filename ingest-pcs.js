require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const POINTS = [100,80,60,50,45,40,36,32,29,26,24,22,20,18,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1];
const RACE_YEAR = 2026;
const RACE_CENTER_BASE = "https://racecenter.lavuelta.es/api";
const VUELTA_RIDERS_URL = "https://www.lavuelta.es/en/riders";
const VUELTA_BASE = "https://www.lavuelta.es";

function riderKey(value) {
  return String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rankings)) return value.rankings;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.results)) return value.results;
  return [];
}

async function fetchJson(url, label) {
  console.log(`\nFetching ${label}...\n${url}`);
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 Vuelta-Fantasy/1.0" } });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return response.json();
}

function firstOfficialImage(html, bib) {
  const escapedBib = String(bib).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`https://img\\.aso\\.fr/[^\\"'<>\\s]*?/img-cycling-vue-png/${escapedBib}/[^\\"'<>\\s]+`, "i"),
    new RegExp(`https://img\\.aso\\.fr/[^\\"'<>\\s]+`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[0]) return match[0].replace(/&amp;/g, "&");
  }
  return null;
}

async function fetchOfficialRiderProfiles(bibs) {
  console.log(`\nFetching official La Vuelta rider directory...\n${VUELTA_RIDERS_URL}`);
  const response = await fetch(VUELTA_RIDERS_URL, {
    headers: { accept: "text/html", "user-agent": "Mozilla/5.0 Vuelta-Fantasy/1.0" }
  });
  if (!response.ok) throw new Error(`La Vuelta rider directory returned HTTP ${response.status}`);
  const html = await response.text();
  const profiles = new Map();

  for (const bib of bibs) {
    const escapedBib = String(bib).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`href=["'](\\/en\\/rider\\/${escapedBib}\\/[^"']+)["']`, "i");
    const match = html.match(pattern);
    if (!match?.[1]) continue;

    const url = `${VUELTA_BASE}${match[1]}`;
    let image = null;
    try {
      const profileResponse = await fetch(url, {
        headers: { accept: "text/html", "user-agent": "Mozilla/5.0 Vuelta-Fantasy/1.0" }
      });
      if (profileResponse.ok) image = firstOfficialImage(await profileResponse.text(), bib);
    } catch (error) {
      console.warn(`Could not fetch profile image for bib ${bib}: ${error.message}`);
    }

    profiles.set(Number(bib), { url, image });
  }

  const images = [...profiles.values()].filter(profile => profile.image).length;
  console.log(`✓ Matched ${profiles.size}/${bibs.length} official rider profiles`);
  console.log(`✓ Matched ${images}/${bibs.length} official rider photos`);
  return profiles;
}

async function importStage(stage, db) {
  const rankingPayload = await fetchJson(`${RACE_CENTER_BASE}/rankingType-${RACE_YEAR}-${stage}`, `RaceCenter Stage ${stage} classification`);
  const rankingData = asArray(rankingPayload);
  if (!rankingData.length) throw new Error("RaceCenter returned no ranking records.");

  const finalClassifications = rankingData.filter(item => {
    const type = String(item.type ?? "").toLowerCase();
    return type === "ite" && asArray(item).length >= 30;
  }).sort((a,b) => Number(b.checkpoint ?? b.checkPoint ?? 0) - Number(a.checkpoint ?? a.checkPoint ?? 0));

  if (!finalClassifications.length) return { imported: false, reason: "No final classification with at least 30 riders yet." };

  const finalRankings = asArray(finalClassifications[0]);
  const competitors = asArray(await fetchJson(`${RACE_CENTER_BASE}/allCompetitors-${RACE_YEAR}`, "RaceCenter competitor data"));
  if (!competitors.length) throw new Error("RaceCenter returned no competitor records.");

  const ridersByBib = new Map();
  for (const competitor of competitors) {
    if (competitor.bib == null) continue;
    const name = [competitor.lastname, competitor.firstname].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!name) continue;
    ridersByBib.set(Number(competitor.bib), { name, key: riderKey(name), bib: Number(competitor.bib) });
  }

  const results = finalRankings.map(r => ({
    ...r,
    position: Number(r.position ?? r.rank ?? r.place),
    bib: Number(r.bib ?? r.bibNumber ?? r.competitorBib)
  })).filter(r => Number.isInteger(r.position) && r.position >= 1 && r.position <= 30).sort((a,b) => a.position - b.position);

  const positions = new Set(results.map(r => r.position));
  if (results.length !== 30 || positions.size !== 30) return { imported: false, reason: `Expected 30 unique positions, found ${results.length}/${positions.size}.` };

  const profiles = await fetchOfficialRiderProfiles(results.map(r => r.bib));
  const riders = results.map(result => {
    const rider = ridersByBib.get(result.bib);
    if (!rider) throw new Error(`Could not resolve rider for bib ${result.bib} at position ${result.position}.`);
    const profile = profiles.get(rider.bib) || {};
    return {
      position: result.position,
      bib: rider.bib,
      name: rider.name,
      key: rider.key,
      url: profile.url || null,
      image: profile.image || null,
      points: POINTS[result.position - 1]
    };
  });

  if (new Set(riders.map(r => r.bib)).size !== 30) throw new Error("Top 30 contains duplicate rider bibs.");

  const { data: stageRow, error: stageError } = await db.from("stages").select("id,stage_number,status").eq("stage_number", stage).single();
  if (stageError) throw new Error(`Could not find Stage ${stage}: ${stageError.message}`);
  if (stageRow.status === "published") return { imported: false, reason: "Already published." };

  const { error: clearError } = await db.from("stage_results").delete().eq("stage_id", stageRow.id);
  if (clearError) throw new Error(`Could not clear existing results: ${clearError.message}`);

  const rows = riders.map(r => ({
    stage_id: stageRow.id,
    finish_position: r.position,
    rider_key: r.key,
    rider_name: r.name,
    rider_url: r.url,
    rider_image: r.image,
    points: r.points
  }));
  const { error: insertError } = await db.from("stage_results").insert(rows);
  if (insertError) throw new Error(`Could not insert stage results: ${insertError.message}`);

  const { error: updateError } = await db.from("stages").update({
    pcs_url: `https://racecenter.lavuelta.es/en/rankings/${stage}`,
    status: "published",
    imported_at: new Date().toISOString()
  }).eq("id", stageRow.id);
  if (updateError) throw new Error(`Results inserted but stage update failed: ${updateError.message}`);

  console.log(`✓ STAGE ${stage} IMPORT COMPLETE — 30 riders`);
  return { imported: true, stage };
}

async function main() {
  const requested = process.argv[2];
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  const db = createClient(supabaseUrl, serviceRoleKey);

  if (requested) {
    const stage = Number(requested);
    if (!Number.isInteger(stage) || stage < 1 || stage > 21) throw new Error("Usage: node ingest-pcs.js <stage>");
    const result = await importStage(stage, db);
    if (!result.imported) console.log(`Nothing imported: ${result.reason}`);
    return;
  }

  const { data: stages, error } = await db.from("stages").select("stage_number,status,result_date").order("stage_number", { ascending: true });
  if (error) throw new Error(`Could not load stages: ${error.message}`);

  for (const stage of stages || []) {
    if (stage.status === "published") continue;
    console.log(`\nAutomatic mode checking Stage ${stage.stage_number}...`);
    const result = await importStage(Number(stage.stage_number), db);
    if (result.imported) return;
    console.log(`Stage ${stage.stage_number}: ${result.reason}`);
    return;
  }

  console.log("All stages are already published.");
}

main().catch(error => {
  console.error("\nERROR:");
  console.error(error.message);
  process.exit(1);
});
