import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const POINTS = [100,80,60,50,45,40,36,32,29,26,24,22,20,18,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1];
const cors = { "content-type": "application/json" };

// PCS does not provide a public results API. This deliberately imports only the published,
// public top-30 table, and safely does nothing if the classification is not available yet.
function decode(value: string) { return value.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(); }
function riderKey(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function parseTopThirty(html: string) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const riders: { position:number; key:string; name:string }[] = [];
  for (const row of rows) {
    const body = row[1];
    const rider = body.match(/href=["']\/rider\/([^"'?/#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(x => decode(x[1]));
    const position = Number(cells.find(x => /^\d{1,2}$/.test(x)));
    if (rider && position >= 1 && position <= 30) { const name = decode(rider[2]); riders.push({ position, key: riderKey(name), name }); }
  }
  return riders.filter((r, i, all) => all.findIndex(x => x.position === r.position) === i).sort((a,b) => a.position-b.position).slice(0,30);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({error:"POST required"}), {status:405,headers:cors});
  if (req.headers.get("x-ingest-secret") !== Deno.env.get("INGEST_SECRET")) return new Response(JSON.stringify({error:"unauthorized"}), {status:401,headers:cors});
  const { stage } = await req.json();
  if (!Number.isInteger(stage) || stage < 1 || stage > 21) return new Response(JSON.stringify({error:"stage must be 1–21"}), {status:400,headers:cors});
  const url = `https://www.procyclingstats.com/race/vuelta-a-espana/2026/stage-${stage}/result/result`;
  const response = await fetch(url, { headers: { "user-agent": "VueltaFantasy results importer/1.0" } });
  if (!response.ok) return new Response(JSON.stringify({error:`PCS returned ${response.status}`}), {status:502,headers:cors});
  const riders = parseTopThirty(await response.text());
  if (riders.length === 0) return new Response(JSON.stringify({stage, imported:false, reason:"No published rider classification found"}), {headers:cors});
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: stageRow, error: stageError } = await db.from("stages").upsert({stage_number:stage,pcs_url:url,status:"published",imported_at:new Date().toISOString()},{onConflict:"stage_number"}).select("id").single();
  if (stageError) throw stageError;
  const { error: clearError } = await db.from("stage_results").delete().eq("stage_id", stageRow.id);
  if (clearError) throw clearError;
  const { error: resultError } = await db.from("stage_results").insert(riders.map(r => ({stage_id:stageRow.id,finish_position:r.position,rider_key:r.key,rider_name:r.name,points:POINTS[r.position-1]})));
  if (resultError) throw resultError;
  return new Response(JSON.stringify({stage,imported:true,riders:riders.length}), {headers:cors});
});
