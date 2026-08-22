/**
 * Deploy this as a Google Apps Script Web App bound to the response Sheet.
 * Add SCRIPT_URL and SHARED_SECRET in Project Settings > Script properties.
 * Required Form questions: Name, Stage, 1st Pick, 2nd Pick, 3rd Pick, 4th Pick, 5th Pick.
 * Google Forms' automatic "Email Address" column is supported.
 * Each rider option must use the exact PCS display name, for example "ALBANESE Vincenzo".
 */
function onFormSubmit(e) {
  const p = PropertiesService.getScriptProperties();
  const row = e.namedValues;
  const pick = (name) => (row[name] || [""])[0].trim();
  // Supports both the original Rider 1–5 labels and the current 1st Pick–5th Pick labels.
  const headings = Object.keys(row);
  const riders = [1,2,3,4,5].map(n => {
    const ordinal = ['1st', '2nd', '3rd', '4th', '5th'][n - 1];
    const heading = headings.find(h => new RegExp(`^(?:Rider\\s*${n}|${ordinal}\\s+Pick)(?:\\s|$)`, 'i').test(h.trim()));
    return heading ? pick(heading) : '';
  });
  const riderKey = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const keys = riders.map(riderKey);
  if (riders.some(r => !r)) throw new Error(`Missing rider answer. Found rider columns: ${headings.filter(h => /(?:Rider|Pick)/i.test(h)).join(', ') || 'none'}`);
  if (new Set(keys).size !== 5) throw new Error('Choose five different riders; the same rider was selected more than once.');
  const stageMatch = pick('Stage').match(/\d+/);
  const stage = stageMatch ? Number(stageMatch[0]) : 0;
  const name = pick('Name');
  const email = pick('Email') || pick('Email Address');
  if (!name) throw new Error('Add a required Google Form question named "Name", then submit a new response.');
  if (!stage) throw new Error('Choose a stage such as "Stage 7".');
  const response = UrlFetchApp.fetch(p.getProperty('SCRIPT_URL'), {
    method: 'post', contentType: 'application/json',
    headers: {'x-submission-secret': p.getProperty('SHARED_SECRET')},
    payload: JSON.stringify({stage, name, email, rider_names: riders, rider_keys: keys}),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() >= 300) throw new Error(`Supabase rejected submission: ${response.getContentText()}`);
}
