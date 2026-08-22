(() => {
  const cfg = window.FANTASY_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const escape = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const empty = (selector, cols, text) => $(selector).innerHTML = `<tr><td colspan="${cols}" class="empty">${text}</td></tr>`;
  if (cfg.googleFormUrl) { const el = $('[data-form-link]'); el.href = cfg.googleFormUrl; el.hidden = false; }
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) { empty('[data-leaderboard]',4,'Configure Supabase to publish standings.'); return; }
  const headers = { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${cfg.supabaseAnonKey}` };
  const get = async (path) => { const r = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {headers}); if (!r.ok) throw new Error(await r.text()); return r.json(); };
  const riderNames = (row) => (row.scoring_riders || []).map(x => `${escape(x.rider_name)} <small>(+${x.points})</small>`).join(', ') || '—';
  (async () => {
    const [leaders, stages] = await Promise.all([get('leaderboard?select=*&order=total_points.desc,participant_name.asc'), get('public_stages?select=*&order=stage_number.desc&limit=1')]);
    $('[data-stage-count]').textContent = `${stages.length ? stages[0].stage_number : 0} stage${stages.length === 1 ? '' : 's'} scored`;
    if (!leaders.length) empty('[data-leaderboard]',4,'No scored predictions yet.');
    else $('[data-leaderboard]').innerHTML = leaders.map((x,i) => `<tr><td class="rank">${i+1}</td><td>${escape(x.participant_name)}</td><td class="number"><strong>${x.total_points}</strong></td><td class="number">${x.stages_scored}</td></tr>`).join('');
    if (!stages.length) return;
    const stage = stages[0];
    $('[data-latest-title]').textContent = `Stage ${stage.stage_number} · ${stage.stage_name || 'Official result'}`;
    $('[data-latest-meta]').textContent = `${stage.result_date || 'Results published'} · top 30 scored`;
    const link = $('[data-latest-link]'); link.href = stage.pcs_url; link.hidden = false;
    $('[data-picks-stage]').textContent = `Stage ${stage.stage_number}`;
    const [scores, picks] = await Promise.all([get(`stage_scores?select=*&stage_id=eq.${stage.id}&order=points.desc,participant_name.asc`), get(`public_predictions?select=participant_name,rider_names,stage_id&stage_id=eq.${stage.id}&order=participant_name.asc`)]);
    if (scores.length) $('[data-daily]').innerHTML = scores.map((x,i) => `<tr><td class="rank">${i+1}</td><td>${escape(x.participant_name)}</td><td>${riderNames(x)}</td><td class="number"><strong>${x.points}</strong></td></tr>`).join('');
    const byName = new Map(scores.map(x => [x.participant_name,x.points]));
    if (picks.length) $('[data-predictions]').innerHTML = picks.map(x => `<article class="pick-card"><h3>${escape(x.participant_name)} <span class="score-tag">${byName.get(x.participant_name) ?? 0} pts</span></h3><ol>${(x.rider_names || []).map(r => `<li>${escape(r)}</li>`).join('')}</ol></article>`).join('');
  })().catch(() => { empty('[data-leaderboard]',4,'Scores are temporarily unavailable.'); });
})();
