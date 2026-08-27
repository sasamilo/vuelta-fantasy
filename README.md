# Vuelta Fantasy

A Hugo scoreboard for a five-rider, per-stage cycling prediction game. Google Forms owns submission; Supabase stores picks, official top-30 stage results, and the views consumed by the static site.

## Current architecture

- **Race results source:** the official La Vuelta RaceCenter API. The project does **not** use ProCyclingStats (PCS) for result retrieval.
- **Importer:** `ingest-vuelta.js` retrieves the next unpublished stage, validates a complete top 30, resolves official La Vuelta rider profile URLs/images, and writes the results to Supabase.
- **Database:** Supabase is the source of truth for published stage results and fantasy scoring.
- **Website:** Hugo provides the static shell; the frontend reads the current published data from Supabase, so winners, top-30 results, stage scores, and the overall leaderboard update from the database rather than from hardcoded stage winners.
- **Scheduling:** automated result retrieval is handled outside the repository. The repository does not contain a scheduled results-import workflow.

## How scoring works

Only a pick that finishes in an official stage top 30 scores. Positions 1–30 receive:

`100, 80, 60, 50, 45, 40, 36, 32, 29, 26, 24, 22, 20, 18, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1`.

`stage_scores` sums matching rider keys per player and stage; `leaderboard` then sums all their stage scores. A participant may replace their own submitted pick while the stage is still scheduled.

## Deploy

1. Create a Supabase project and run the migrations in `supabase/migrations/`.
2. Deploy the submission Edge Function:

   ```sh
   supabase functions deploy submit-google-form --no-verify-jwt
   ```

3. Create a Google Form linked to a response Sheet. Add required questions named `Name`, `Stage`, `1st Pick`, `2nd Pick`, `3rd Pick`, `4th Pick`, and `5th Pick`. Google Forms' automatic `Email Address` column is supported. Paste `docs/google-apps-script.js` into the Sheet's Apps Script project, configure its secrets as Script Properties, and add an installable **On form submit** trigger.
4. Set the submission function URL in the Apps Script configuration. Keep all service credentials and shared secrets in environment/configuration storage; never commit them to this repository.
5. In `static/config.js`, use only the Supabase project URL and **anon** key needed by the public frontend. Never put a service-role key in the frontend.
6. Build and host the site:

   ```sh
   hugo --minify
   ```

   Deploy the generated `public/` directory to any static host.

## Import official stage results

The production importer is `ingest-vuelta.js`. It uses the official La Vuelta RaceCenter API and does not access PCS.

It can run automatically without specifying a stage; it checks Supabase for the first unpublished stage and attempts to import it:

```sh
node ingest-vuelta.js
```

For a manual recovery or verification, specify the stage number:

```sh
node ingest-vuelta.js 7
```

The importer:

1. Requests the stage classification from the RaceCenter API.
2. Refuses to publish incomplete classifications and requires exactly 30 unique finishing positions.
3. Gets the RaceCenter competitor directory to resolve rider identities.
4. Resolves riders against the official La Vuelta rider directory rather than assuming RaceCenter bib numbers are official profile IDs.
5. Stores the official rider profile URL and available official rider image in `stage_results`.
6. Assigns the fixed 1–30 fantasy points.
7. Writes the 30 results to Supabase and marks the stage as `published` only after the complete set is available.

The importer is safe to rerun for an unpublished stage. Published stages are skipped.

### Required local environment

The local importer expects these environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Keep these values in a local `.env` file that is ignored by Git. **Never commit the `.env` file or a service-role key.**

## Local preview

```sh
hugo server -D
```

## Manual recovery

If automated retrieval does not succeed, the same API-based importer can be run locally on a Mac. For example:

```sh
node ingest-vuelta.js 7
```

This uses the La Vuelta RaceCenter API directly and writes the verified result to the configured Supabase project. No PCS scraping is involved.
