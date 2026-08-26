(() => {
  const cfg = window.FANTASY_CONFIG || {};
  const route = window.VUELTA_ROUTE || {};
  const participantImages = window.PARTICIPANT_IMAGES?.participants || {};
  const $ = (s) => document.querySelector(s);
  const escape = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const empty = (selector, cols, text) => $(selector).innerHTML = `<tr><td colspan="${cols}" class="empty">${text}</td></tr>`;
  const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0].replace(/[.,]/g, '');
  const participantImage = (name) => {
    const first = firstName(name);
    return participantImages[first] || participantImages[first.normalize('NFD').replace(/[\u0300-\u036f]/g, '')] || '';
  };
  const participantMarkup = (name) => {
    const safeName = escape(name);
    const image = participantImage(name);
    return image
      ? `<span class="participant-cell"><img class="participant-avatar" src="${escape(image)}" alt="" loading="lazy"> <span>${safeName}</span></span>`
      : safeName;
  };
  if (cfg.googleFormUrl) { const el = $('[data-form-link]'); el.href = cfg.googleFormUrl; el.hidden = false; }
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) { empty('[data-leaderboard]',4,'Configure Supabase to publish standings.'); return; }
  const headers = { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${cfg.supabaseAnonKey}` };
  const get = async (path) => { const r = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {headers}); if (!r.ok) throw new Error(await r.text()); return r.json(); };
  const riderNames = (row) => (row.scoring_riders || []).map(x => `${escape(x.rider_name)} <small>(+${x.points})</small>`).join(', ') || '—';
  const stageResults = (results) => {
    const grouped = new Map();
    results.forEach(row => {
      if (!grouped.has(row.stage_id)) grouped.set(row.stage_id, { stage: row, riders: [] });
      grouped.get(row.stage_id).riders.push(row);
    });
    if (!grouped.size) {
      $('[data-stage-results]').innerHTML = '<p class="empty">No official stage results are available yet.</p>';
      return;
    }
    $('[data-stage-results]').innerHTML = [...grouped.values()].map(({ stage, riders }, index) => `
      <details class="stage-result"${index === 0 ? ' open' : ''}>
        <summary><span>Stage ${stage.stage_number}${stage.stage_name ? ` · ${escape(stage.stage_name)}` : ''}</span><span class="pill">Top 30</span></summary>
        <div class="table-wrap"><table><thead><tr><th>Place</th><th>Rider</th><th class="number">Points</th></tr></thead><tbody>
          ${riders.map(rider => `<tr><td class="rank">${rider.finish_position}</td><td>${escape(rider.rider_name)}</td><td class="number"><strong>${rider.points}</strong></td></tr>`).join('')}
        </tbody></table></div>
      </details>`).join('');
  };
  const showWinner = (winner) => {
    if (!winner?.name || !winner?.image) return;
    const card = $('[data-stage-winner]');
    const image = $('[data-winner-image]');
    image.src = winner.image;
    image.alt = winner.name;
    $('[data-winner-name]').textContent = winner.display_name || winner.name;
    $('[data-winner-team]').textContent = winner.team || '';
    card.href = winner.url || '#';
    card.hidden = false;
  };
  (async () => {
    const [leaders, stages, results] = await Promise.all([get('leaderboard?select=*&order=total_points.desc,participant_name.asc'), get('public_stages?select=*&order=stage_number.desc&limit=1'), get('public_stage_results?select=stage_id,stage_number,stage_name,finish_position,rider_name,points&order=stage_number.desc,finish_position.asc')]);
    stageResults(results);
    $('[data-stage-count]').textContent = `${stages.length ? stages[0].stage_number : 0} stage${stages.length === 1 ? '' : 's'} scored`;
    if (!leaders.length) empty('[data-leaderboard]',4,'No scored predictions yet.');
    else $('[data-leaderboard]').innerHTML = leaders.map((x,i) => `<tr><td class="rank">${i+1}</td><td>${participantMarkup(x.participant_name)}</td><td class="number"><strong>${x.total_points}</strong></td><td class="number">${x.stages_scored}</td></tr>`).join('');
    if (!stages.length) return;
    const stage = stages[0];
    const routeStage = route.stages?.[stage.stage_number];
    if (routeStage) {
      $('[data-latest-eyebrow]').textContent = `Stage ${stage.stage_number}`;
      $('[data-latest-title]').textContent = `${routeStage.start} → ${routeStage.finish}`;
      $('[data-latest-meta]').textContent = `${routeStage.type} · ${routeStage.distance} · ${routeStage.date}`;
      const link = $('[data-latest-link]');
      link.href = routeStage.official_url || stage.pcs_url || '#';
      link.textContent = 'View stage ↗';
      link.hidden = false;
      if (routeStage.winner) showWinner(routeStage.winner);
    } else {
      $('[data-latest-title]').textContent = `Stage ${stage.stage_number} · ${stage.stage_name || 'Official result'}`;
      $('[data-latest-meta]').textContent = `${stage.result_date || 'Results published'} · top 30 scored`;
      const link = $('[data-latest-link]'); link.href = stage.pcs_url || '#'; link.hidden = !stage.pcs_url;
    }
    $('[data-picks-stage]').textContent = `Stage ${stage.stage_number}`;
    const [scores, picks] = await Promise.all([get(`stage_scores?select=*&stage_id=eq.${stage.id}&order=points.desc,participant_name.asc`), get(`public_predictions?select=participant_name,rider_names,stage_id&stage_id=eq.${stage.id}&order=participant_name.asc`)]);
    if (scores.length) $('[data-daily]').innerHTML = scores.map((x,i) => `<tr><td class="rank">${i+1}</td><td>${participantMarkup(x.participant_name)}</td><td>${riderNames(x)}</td><td class="number"><strong>${x.points}</strong></td></tr>`).join('');
    const byName = new Map(scores.map(x => [x.participant_name,x.points]));
    if (picks.length) $('[data-predictions]').innerHTML = picks.map(x => `<article class="pick-card"><h3><span class="participant-heading">${participantMarkup(x.participant_name)}</span> <span class="score-tag">${byName.get(x.participant_name) ?? 0} pts</span></h3><ol>${(x.rider_names || []).map(r => `<li>${escape(r)}</li>`).join('')}</ol></article>`).join('');
  })().catch(() => { empty('[data-leaderboard]',4,'Scores are temporarily unavailable.'); $('[data-stage-results]').innerHTML = '<p class="empty">Official results are temporarily unavailable.</p>'; });
})();
