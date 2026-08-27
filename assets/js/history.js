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

  (async () => {
    try {
      const [stages, scores, predictions] = await Promise.all([
        get('public_stages?select=id,stage_number,stage_name&order=stage_number.desc'),
        get('stage_scores?select=stage_id,participant_name,points,scoring_riders&order=stage_id.desc,points.desc,participant_name.asc'),
        get('public_predictions?select=stage_id,participant_name,rider_names&order=stage_id.desc,participant_name.asc')
      ]);

      // public_stages has no status column. The newest stage in this table is the
      // current stage already rendered by app.js; everything older is history.
      const latestStageNumber = stages.length ? Number(stages[0].stage_number) : 0;
      const stageById = new Map(stages.map((stage) => [Number(stage.id), stage]));

      const scoresByStage = new Map();
      scores.forEach((row) => {
        const stage = stageById.get(Number(row.stage_id));
        if (!stage || Number(stage.stage_number) >= latestStageNumber) return;
        if (!scoresByStage.has(Number(row.stage_id))) scoresByStage.set(Number(row.stage_id), []);
        scoresByStage.get(Number(row.stage_id)).push(row);
      });

      const dailyPanel = $('#daily-history');
      const dailyContainer = $('[data-daily-history]');
      if (dailyPanel && dailyContainer && scoresByStage.size) {
        dailyContainer.innerHTML = [...scoresByStage.entries()]
          .sort((a, b) => Number(stageById.get(b[0]).stage_number) - Number(stageById.get(a[0]).stage_number))
          .map(([stageId, rows], index) => {
            const stage = stageById.get(stageId);
            return `<details class="stage-result"${index === 0 ? ' open' : ''}><summary><span>Stage ${stage.stage_number}${stage.stage_name ? ` · ${escape(stage.stage_name)}` : ''}</span><span class="pill">Daily scores</span></summary><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Player</th><th>Scoring riders</th><th class="number">Points</th></tr></thead><tbody>${scoreRows(rows)}</tbody></table></div></details>`;
          }).join('');
        dailyPanel.hidden = false;
      }

      const predictionsByStage = new Map();
      predictions.forEach((row) => {
        const stage = stageById.get(Number(row.stage_id));
        if (!stage || Number(stage.stage_number) >= latestStageNumber) return;
        if (!predictionsByStage.has(Number(row.stage_id))) predictionsByStage.set(Number(row.stage_id), []);
        predictionsByStage.get(Number(row.stage_id)).push(row);
      });

      const scoresByName = new Map(scores.map((row) => [`${row.stage_id}|${row.participant_name}`, row.points]));
      const picksPanel = $('#picks-history');
      const picksContainer = $('[data-picks-history]');
      if (picksPanel && picksContainer && predictionsByStage.size) {
        picksContainer.innerHTML = [...predictionsByStage.entries()]
          .sort((a, b) => Number(stageById.get(b[0]).stage_number) - Number(stageById.get(a[0]).stage_number))
          .map(([stageId, rows], index) => {
            const stage = stageById.get(stageId);
            return `<details class="stage-result"${index === 0 ? ' open' : ''}><summary><span>Stage ${stage.stage_number}${stage.stage_name ? ` · ${escape(stage.stage_name)}` : ''}</span><span class="pill">Predictions</span></summary><div class="picks-grid">${rows.map((row) => `<article class="pick-card"><h3>${participantMarkup(row.participant_name)} <span class="score-tag">${scoresByName.get(`${row.stage_id}|${row.participant_name}`) ?? 0} pts</span></h3><ol>${(row.rider_names || []).map((name) => `<li>${escape(name)}</li>`).join('')}</ol></article>`).join('')}</div></details>`;
          }).join('');
        picksPanel.hidden = false;
      }
    } catch (error) {
      console.warn('Historic Vuelta data unavailable:', error);
    }
  })();
})();
