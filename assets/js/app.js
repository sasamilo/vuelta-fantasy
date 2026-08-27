(() => {
  const cfg = window.FANTASY_CONFIG || {};
  const route = window.VUELTA_ROUTE || {};
  const participantImages = {
    sasa: "https://thinktank.preskok.si/wp-content/uploads/2026/02/Sasa-Milo-768x768.webp",
    lovro: "https://i.imgur.com/7OdZQyk.jpg",
    robert: "https://preskok.si/wp-content/uploads/2025/08/Robert-Golob.webp",
    samo: "https://autobrief.io/wp-content/uploads/2025/09/Samo_Pavlovic-portfolio.webp",
    matej: "https://preskok.si/wp-content/uploads/2025/08/Matej-Klinc.webp",
    blaz: "https://preskok.si/wp-content/uploads/2026/05/Blaz-Lipar.webp"
  };

  const $ = (s) => document.querySelector(s);
  const escape = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const empty = (selector, cols, text) => { const el = $(selector); if (el) el.innerHTML = `<tr><td colspan="${cols}" class="empty">${text}</td></tr>`; };
  const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0].replace(/[.,]/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const participantImage = (name) => participantImages[firstName(name)] || '';
  const participantMarkup = (name) => {
    const safeName = escape(name);
    const image = participantImage(name);
    return image
      ? `<span class="participant-cell"><img class="participant-avatar" src="${escape(image)}" alt="${safeName}" loading="lazy"> <span>${safeName}</span></span>`
      : safeName;
  };

  if (cfg.googleFormUrl) {
    const el = $('[data-form-link]');
    el.href = cfg.googleFormUrl;
    el.hidden = false;
  }

  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    empty('[data-leaderboard]', 4, 'Configure Supabase to publish standings.');
    return;
  }

  const headers = {
    apikey: cfg.supabaseAnonKey,
    Authorization: `Bearer ${cfg.supabaseAnonKey}`
  };

  const get = async (path) => {
    const r = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, { headers });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  };

  const riderNames = (row) => (row.scoring_riders || [])
    .map(x => `${escape(x.rider_name)} <small>(+${x.points})</small>`)
    .join(', ') || '—';

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

  const initials = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const first = parts[0].replace(/[^A-Za-zÀ-ž]/g, '');
    const last = parts.length > 1 ? parts[parts.length - 1].replace(/[^A-Za-zÀ-ž]/g, '') : '';
    return `${first.charAt(0)}${last.charAt(0) || ''}`.toUpperCase();
  };

  const winnerFallbackImage = (name) => {
    const text = escape(initials(name));
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="#d9ff43"/><text x="150" y="220" text-anchor="middle" font-family="Arial,sans-serif" font-size="88" font-weight="900" fill="#11231f">${text}</text></svg>`)}`;
  };

  // The winner card is intentionally driven by the same official published
  // stage-result rows that came from La Vuelta's Race Center API. Route YAML
  // is NOT used to decide who won, so every new published stage works without
  // manually adding a winner to vuelta_route.yaml.
  const showWinner = (winner) => {
    if (!winner?.name) return;
    const card = $('[data-stage-winner]');
    const image = $('[data-winner-image]');
    if (!card || !image) return;
    image.src = winner.image || winnerFallbackImage(winner.name);
    image.alt = winner.name;
    $('[data-winner-name]').textContent = winner.display_name || winner.name;
    $('[data-winner-team]').textContent = winner.team || '';
    card.href = winner.url || '#';
    card.hidden = false;
  };

  (async () => {
    const [leaders, stages, results] = await Promise.all([
      get('leaderboard?select=*&order=total_points.desc,participant_name.asc'),
      get('public_stages?select=*&order=stage_number.desc&limit=1'),
      get('public_stage_results?select=stage_id,stage_number,stage_name,finish_position,rider_name,points&order=stage_number.desc,finish_position.asc')
    ]);

    stageResults(results);

    const stageCount = stages.length ? stages[0].stage_number : 0;
    $('[data-stage-count]').textContent = `${stageCount} stage${stageCount === 1 ? '' : 's'} scored`;

    if (!leaders.length) {
      empty('[data-leaderboard]', 4, 'No scored predictions yet.');
    } else {
      $('[data-leaderboard]').innerHTML = leaders.map((x, i) => `
        <tr><td class="rank">${i + 1}</td><td>${participantMarkup(x.participant_name)}</td><td class="number"><strong>${x.total_points}</strong></td><td class="number">${x.stages_scored}</td></tr>
      `).join('');
    }

    if (!stages.length) return;

    const stage = stages[0];
    const routeStage = route.stages?.[stage.stage_number];

    // Location card continues to use the route data, which mirrors the
    // official La Vuelta stage information.
    if (routeStage) {
      $('[data-latest-eyebrow]').textContent = `Stage ${stage.stage_number}`;
      $('[data-latest-title]').textContent = `${routeStage.start} → ${routeStage.finish}`;
      $('[data-latest-meta]').textContent = `${routeStage.type} · ${routeStage.distance} · ${routeStage.date}`;
      const link = $('[data-latest-link]');
      link.href = routeStage.official_url || stage.pcs_url || '#';
      link.textContent = 'View stage ↗';
      link.hidden = false;
    } else {
      $('[data-latest-title]').textContent = `Stage ${stage.stage_number} · ${stage.stage_name || 'Official result'}`;
      $('[data-latest-meta]').textContent = `${stage.result_date || 'Results published'} · top 30 scored`;
      const link = $('[data-latest-link]');
      link.href = stage.pcs_url || '#';
      link.hidden = !stage.pcs_url;
    }

    // UNIVERSAL STAGE WINNER:
    // position 1 from the latest published official classification is always
    // the winner. No per-stage winner entry is required in route YAML.
    const latestWinner = results.find(
      r => Number(r.stage_id) === Number(stage.id) && Number(r.finish_position) === 1
    );

    if (latestWinner) {
      const routeWinner = routeStage?.winner;
      showWinner({
        name: latestWinner.rider_name,
        // Keep a manually supplied presentation name/image only as optional
        // decoration. The identity and winner status always come from results.
        display_name: routeWinner?.display_name || latestWinner.rider_name,
        team: routeWinner?.team || '',
        image: routeWinner?.image || '',
        url: routeWinner?.url || '#'
      });
    }

    $('[data-picks-stage]').textContent = `Stage ${stage.stage_number}`;

    const [scores, picks] = await Promise.all([
      get(`stage_scores?select=*&stage_id=eq.${stage.id}&order=points.desc,participant_name.asc`),
      get(`public_predictions?select=participant_name,rider_names,stage_id&stage_id=eq.${stage.id}&order=participant_name.asc`)
    ]);

    if (scores.length) {
      $('[data-daily]').innerHTML = scores.map((x, i) => `
        <tr><td class="rank">${i + 1}</td><td>${participantMarkup(x.participant_name)}</td><td>${riderNames(x)}</td><td class="number"><strong>${x.points}</strong></td></tr>
      `).join('');
    } else {
      empty('[data-daily]', 4, 'No predictions were submitted for this stage.');
    }

    const byName = new Map(scores.map(x => [x.participant_name, x.points]));
    if (picks.length) {
      $('[data-predictions]').innerHTML = picks.map(x => `
        <article class="pick-card"><h3><span class="participant-heading">${participantMarkup(x.participant_name)}</span> <span class="score-tag">${byName.get(x.participant_name) ?? 0} pts</span></h3><ol>${(x.rider_names || []).map(r => `<li>${escape(r)}</li>`).join('')}</ol></article>
      `).join('');
    }
  })().catch((error) => {
    console.error('Vuelta Fantasy data load failed:', error);
    empty('[data-leaderboard]', 4, 'Scores are temporarily unavailable.');
    empty('[data-daily]', 4, 'Scores are temporarily unavailable.');
    $('[data-stage-results]').innerHTML = '<p class="empty">Official results are temporarily unavailable.</p>';
  });
})();
