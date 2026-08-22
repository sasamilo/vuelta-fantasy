import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (req.headers.get("x-submission-secret") !== Deno.env.get("SUBMISSION_SECRET")) return json({ error: "unauthorized" }, 401);
  const body = await req.json();
  const stage = Number(body.stage);
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const riderKeys = Array.isArray(body.rider_keys) ? body.rider_keys.map(String) : [];
  const riderNames = Array.isArray(body.rider_names) ? body.rider_names.map(String) : [];
  if (!Number.isInteger(stage) || stage < 1 || stage > 21 || name.length < 2 || !email.includes("@") || riderKeys.length !== 5 || riderNames.length !== 5 || new Set(riderKeys).size !== 5 || riderKeys.some(k => !/^[a-z0-9-]+$/.test(k))) return json({ error: "Invalid prediction" }, 422);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: stageRow, error: stageError } = await db.from("stages").select("id,status").eq("stage_number", stage).single();
  if (stageError || !stageRow) return json({ error: "Unknown stage" }, 404);
  if (stageRow.status === "published") return json({ error: "Predictions are closed for this stage" }, 409);
  const { error } = await db.from("predictions").upsert({ stage_id: stageRow.id, participant_name: name, participant_email: email, rider_keys: riderKeys, rider_names: riderNames }, { onConflict: "stage_id,participant_email" });
  if (error) return json({ error: "Could not save prediction" }, 500);
  return json({ saved: true, stage });
});
