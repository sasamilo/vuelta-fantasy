# Vuelta Fantasy

A Hugo scoreboard for a five-rider, per-stage cycling prediction game. Google Forms owns submission; Supabase stores picks, imports official top-30 results, and calculates the views consumed by the static site.

## How scoring works

Only a pick that finishes in an official stage top 30 scores. Positions 1–30 receive:

`100, 80, 60, 50, 45, 40, 36, 32, 29, 26, 24, 22, 20, 18, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1`.

`stage_scores` sums matching rider keys per player and stage; `leaderboard` then sums all their stage scores. A participant may replace their own submitted pick while the stage is still scheduled.

## Deploy

1. Create a Supabase project and run [the migration](supabase/migrations/202608220001_fantasy_schema.sql) in the SQL editor.
2. Deploy both functions (from a Supabase CLI project):

   ```sh
   supabase functions deploy ingest-pcs --no-verify-jwt
   supabase functions deploy submit-google-form --no-verify-jwt
   supabase secrets set INGEST_SECRET=replace-me SUBMISSION_SECRET=replace-me
   ```

3. Create a Google Form linked to a response Sheet. Add required questions named `Name`, `Stage`, `1st Pick`, `2nd Pick`, `3rd Pick`, `4th Pick`, and `5th Pick`. Google Forms’ automatic `Email Address` column is supported. Use the exact PCS display name as every rider choice (for example, `ALBANESE Vincenzo`); the supplied script converts it to a reliable matching key. Paste [the Apps Script](docs/google-apps-script.js) into the Sheet’s Apps Script project, set its two Script Properties, and add an installable **On form submit** trigger.
4. Set `SCRIPT_URL` to `https://YOUR_PROJECT.supabase.co/functions/v1/submit-google-form`; use the same `SUBMISSION_SECRET` in `SHARED_SECRET`.
5. Replace the values in [static/config.js](static/config.js) with the project URL, **anon** key, and form URL. The anon key is intentionally public; never put a service-role key in this file.
6. Build and host the site:

   ```sh
   hugo --minify
   ```

   Deploy the generated `public/` directory to any static host.

## Import each official stage

After official results are available, call the protected importer once for that stage:

```sh
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/ingest-pcs \
  -H 'content-type: application/json' \
  -H 'x-ingest-secret: replace-me' \
  -d '{"stage":1}'
```

It retrieves the matching PCS URL (`.../stage-1/result/result`), verifies that ranked riders exist, upserts the stage result, and recalculates the public views automatically. It is idempotent, so it is safe to rerun for official corrections. PCS has no public results API; ensure this use complies with its terms and rate-limit calls to one completed-stage request.

To automate, schedule the same request after each stage’s official classification is published (for example, a protected GitHub Actions workflow or Supabase cron invoking the Edge Function).

## Local preview

```sh
hugo server -D
```
# vuelta-fantasy
