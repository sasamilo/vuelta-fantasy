(() => {
  const cfg = window.FANTASY_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return;

  const $ = (selector) => document.querySelector(selector);
  const escape = (value) => String(value ?? '').replace(/[&<>\"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const headers = { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${cfg.supabaseAnonKey}` };
  const get = async (path) => {
    const response = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, { headers });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  };
  const participantImages = window.PARTICIPANT_IMAGES || {};
  const participantMarkup = (name) => {
    const safe = escape(name);
    const key = String(name || '').trim().split(/\s+/)[0].toLowerCase();
    const image = participantImages[key] || '';
    return image ? `<span class="participant-cell"><img class="participant-avatar" src="${escape(image)}" alt="${safe}" loading="lazy"> <span>${safe}</span></span>` : safe;
  };
  const scoreRows = (rows) => rows.map((row, index) => {
    const riders = (row.scoring_riders || []).map((rider) => `${escape(rider.rider_name)} <small>(+${rider.points})</small>`).join(', ') || '—';
    return `<tr><td class="rank">${index + 1}</td><td>${participantMarkup(row.participant_name)}</td><td>${riders}</td><td class="number"><strong>${row.points}</strong></td></tr>`;
  }).join('');
  const renderScores = (stages, scores, latestId) => {
    const container = $('[data-daily-history]');
    const panel = $('#daily-history');
    if (!container || !panel) return;
    const byStage = new Map();
    scores.forEach((row) => { if (!byStage.has(Number(row.stage_id))) byStage.set(Number(row.stage_id), []); byStage.get(Number(row.stage_id)).push(row); });
    const history = stages.filter((stage) => Number(stage.id) !== Number(latestId) && byStage.has(Number(stage.id)));
    if (!history.length) return;
    container.innerHTML = history.map((stage, index) => `<details class="stage-result"${index === 0 ? ' open' : ''}><summary><span>Stage ${stage.stage_number}${stage.stage_name ? ` · ${escape(stage.stage_name)}` : ''}</span><span class="pill">Daily scores</span></summary><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Player</th><th>Scoring riders</th><th class="number">Points</th></tr></thead><tbody>${scoreRows(byStage.get(Number(stage.id)))}</tbody></table></div></details>`).join('');
    panel.hidden = false;
  };
  const renderPredictions = (stages, predictions, scores, latestId) => {
    const container = $('[data-picks-history]');
    const panel = $('#picks-history');
    if (!container || !panel) return;
    const predictionsByStage = new Map();
    predictions.forEach((row) => { if (!predictionsByStage.has(Number(row.stage_id))) predictionsByStage.set(Number(row.stage_id), []); predictionsByStage.get(Number(row.stage_id)).push(row); });
    const scoresByName = new Map();
    scores.forEach((row) => scoresByName.set(`${row.stage_id}|${row.participant_name}`, row.points));
    const history = stages.filter((stage) => Number(stage.id) !== Number(latestId) && predictionsByStage.has(Number(stage.id)));
    if (!history.length) return;
    container.innerHTML = history.map((stage, index) => `<details class="stage-result"${index === 0 ? ' open' : ''}><summary><span>Stage ${stage.stage_number}${stage.stage_name ? ` · ${escape(stage.stage_name)}` : ''}</span><span class="pill">Predictions</span></summary><div class="picks-grid">${predictionsByStage.get(Number(stage.id)).map((row) => `<article class="pick-card"><h3>${participantMarkup(row.participant_name)} <span class="score-tag">${scoresByName.get(`${row.stage_id}|${row.participant_name}`) ?? 0} pts</span></h3><ol>${(row.rider_names || []).map((name) => `<li>${escape(name)}</li>`).join('')}</ol></article>`).join('')}</div></details>`).join('');
    panel.hidden = false;
  };

  (async () => {
    try {
      const [stages, scores, predictions] = await Promise.all([
        get('public_stages?select=id,stage_number,stage_name,status&order=stage_number.desc'),
        get('stage_scores?select=stage_id,participant_name,points,scoring_riders&order=stage_id.desc,points.desc,participant_name.asc'),
        get('public_predictions?select=stage_id,participant_name,rider_names&order=stage_id.desc,participant_name.asc')
      ]);
      const published = stages.filter((stage) => stage.status === 'published');
      const latestId = published.length ? published[0].id : null;
      renderScores(published, scores, latestId);
      renderPredictions(published, predictions, scores, latestId);
    } catch (error) {
      console.warn('Historic Vuelta data unavailable:', error);
    }
  })();
})();
