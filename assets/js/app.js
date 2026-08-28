(() => {
  const cfg = window.FANTASY_CONFIG || {};
  const route = window.VUELTA_ROUTE || {};
  const participantImages = {
    sasa:'https://thinktank.preskok.si/wp-content/uploads/2026/02/Sasa-Milo-768x768.webp',
    lovro:'https://i.imgur.com/7OdZQyk.jpg',
    robert:'https://preskok.si/wp-content/uploads/2025/08/Robert-Golob.webp',
    samo:'https://autobrief.io/wp-content/uploads/2025/09/Samo_Pavlovic-portfolio.webp',
    matej:'https://preskok.si/wp-content/uploads/2025/08/Matej-Klinc.webp',
    blaz:'https://preskok.si/wp-content/uploads/2026/05/Blaz-Lipar.webp'
  };
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const firstName = n => String(n||'').trim().split(/\s+/)[0].replace(/[.,]/g,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const participant = n => { const name=esc(n), img=participantImages[firstName(n)]; return img ? `<span class="participant-cell"><img class="participant-avatar" src="${img}" alt="${name}" loading="lazy"> <span>${name}</span></span>` : name; };
  const empty = (sel, cols, text) => { const e=$(sel); if(e) e.innerHTML=`<tr><td colspan="${cols}" class="empty">${esc(text)}</td></tr>`; };
  if(cfg.googleFormUrl){ const e=$('[data-form-link]'); if(e){e.href=cfg.googleFormUrl;e.hidden=false;} }
  if(!cfg.supabaseUrl || !cfg.supabaseAnonKey){ empty('[data-leaderboard]',4,'Configure Supabase to publish standings.'); return; }
  const headers={apikey:cfg.supabaseAnonKey,Authorization:`Bearer ${cfg.supabaseAnonKey}`};
  const get=async path=>{const r=await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`,{headers});if(!r.ok)throw new Error(`${r.status}: ${await r.text()}`);return r.json();};
  const fallback=n=>`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="#d9ff43"/><text x="150" y="220" text-anchor="middle" font-family="Arial" font-size="88" font-weight="900" fill="#11231f">${esc(String(n||'?').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase())}</text></svg>`)}`;
  const renderLeaderboard = async () => { try { const rows=await get('leaderboard?select=*&order=total_points.desc,participant_name.asc'); if(!rows.length) empty('[data-leaderboard]',4,'No scored predictions yet.'); else $('[data-leaderboard]').innerHTML=rows.map((x,i)=>`<tr><td class="rank">${i+1}</td><td>${participant(x.participant_name)}</td><td class="number"><strong>${x.total_points}</strong></td><td class="number">${x.stages_scored}</td></tr>`).join(''); } catch(e){ console.error('Leaderboard:',e); empty('[data-leaderboard]',4,'Scores are temporarily unavailable.'); } };
  const renderStages = async () => {
    let stages, results;
    try { stages=await get('public_stages?select=id,stage_number,stage_name,result_date,pcs_url&order=stage_number.desc'); } catch(e){ console.error('Stages:',e); $('[data-stage-results]').innerHTML='<p class="empty">Official results are temporarily unavailable.</p>'; return; }
    try { results=await get('public_rider_results?select=stage_id,stage_number,stage_name,finish_position,rider_name,rider_url,rider_image,points&order=stage_number.desc,finish_position.asc'); } catch(e){ console.error('Results:',e); $('[data-stage-results]').innerHTML='<p class="empty">Official results are temporarily unavailable.</p>'; return; }
    const latest=stages[0];
    if(!latest){ $('[data-stage-results]').innerHTML='<p class="empty">No official stage results are available yet.</p>'; return; }
    const count=Number(latest.stage_number)||0; const countEl=$('[data-stage-count]'); if(countEl)countEl.textContent=`${count} stage${count===1?'':'s'} scored`;
    const routeStage=route.stages?.[count];
    if(routeStage){ $('[data-latest-eyebrow]').textContent=`Stage ${count}`; $('[data-latest-title]').textContent=`${routeStage.start} → ${routeStage.finish}`; $('[data-latest-meta]').textContent=`${routeStage.type} · ${routeStage.distance} · ${routeStage.date}`; const l=$('[data-latest-link]'); if(l){l.href=routeStage.official_url||latest.pcs_url||'#';l.textContent='View stage ↗';l.hidden=false;} }
    else { $('[data-latest-title]').textContent=`Stage ${count} · ${latest.stage_name||'Official result'}`; $('[data-latest-meta]').textContent=`${latest.result_date||'Results published'} · top 30 scored`; const l=$('[data-latest-link]'); if(l){l.href=latest.pcs_url||'#';l.hidden=!latest.pcs_url;} }
    const groups=new Map(); results.forEach(r=>{if(!groups.has(r.stage_id))groups.set(r.stage_id,[]);groups.get(r.stage_id).push(r);});
    const stageContainer=$('[data-stage-results]');
    if(stageContainer) stageContainer.innerHTML=[...groups.entries()].sort((a,b)=>Number(b[1][0].stage_number)-Number(a[1][0].stage_number)).map(([id,rs],i)=>{const s=rs[0];return `<details class="stage-result"${i===0?' open':''}><summary><span>Stage ${s.stage_number}${s.stage_name?` · ${esc(s.stage_name)}`:''}</span><span class="pill">Top 30</span></summary><div class="table-wrap"><table><thead><tr><th>Place</th><th>Rider</th><th class="number">Points</th></tr></thead><tbody>${rs.map(r=>`<tr><td class="rank">${r.finish_position}</td><td>${esc(r.rider_name)}</td><td class="number"><strong>${r.points}</strong></td></tr>`).join('')}</tbody></table></div></details>`}).join('') || '<p class="empty">No official stage results are available yet.</p>';
    const winner=results.find(r=>Number(r.stage_id)===Number(latest.id)&&Number(r.finish_position)===1);
    if(winner){ const card=$('[data-stage-winner]'),img=$('[data-winner-image]'); if(card&&img){const fi=fallback(winner.rider_name);img.onerror=()=>{img.onerror=null;img.src=fi;};img.src=winner.rider_image||fi;img.alt=winner.rider_name;const n=$('[data-winner-name]'),t=$('[data-winner-team]');if(n)n.textContent=routeStage?.winner?.display_name||winner.rider_name;if(t)t.textContent=routeStage?.winner?.team||'';card.href=winner.rider_url||'#';card.target='_blank';card.rel='noopener';card.hidden=false;} }
    await renderDailyAndPredictions(latest.id,count);
  };
  const renderDailyAndPredictions = async(stageId,stageNumber) => {
    const stageEl=$('[data-picks-stage]'); if(stageEl)stageEl.textContent=`Stage ${stageNumber}`;
    let scores,picks;
    try{scores=await get(`stage_scores?select=*&stage_id=eq.${stageId}&order=points.desc,participant_name.asc`);}catch(e){console.error('Daily scores:',e);empty('[data-daily]',4,'Daily scores are temporarily unavailable.');scores=[];}
    try{picks=await get(`public_predictions?select=participant_name,rider_names,stage_id&stage_id=eq.${stageId}&order=participant_name.asc`);}catch(e){console.error('Predictions:',e);picks=[];}
    if(scores.length)$('[data-daily]').innerHTML=scores.map((x,i)=>`<tr><td class="rank">${i+1}</td><td>${participant(x.participant_name)}</td><td>${(x.scoring_riders||[]).map(r=>`${esc(r.rider_name)} <small>(+${r.points})</small>`).join(', ')||'—'}</td><td class="number"><strong>${x.points}</strong></td></tr>`).join('');else if($('[data-daily]'))empty('[data-daily]',4,'No daily scores were submitted for this stage.');
    const byName=new Map(scores.map(x=>[x.participant_name,x.points])); if(picks.length)$('[data-predictions]').innerHTML=picks.map(x=>`<article class="pick-card"><h3><span class="participant-heading">${participant(x.participant_name)}</span> <span class="score-tag">${byName.get(x.participant_name)??0} pts</span></h3><ol>${(x.rider_names||[]).map(r=>`<li>${esc(r)}</li>`).join('')}</ol></article>`).join('');
  };
  renderLeaderboard();
  renderStages();

  // Historic sections are isolated so an optional history/schema issue can never hide current results.
  (async()=>{try{
    const stages=await get('public_stages?select=id,stage_number,stage_name&order=stage_number.desc');
    if(stages.length<2)return;
    const current=stages[0]; const historic=stages.slice(1);
    const scores=await get('stage_scores?select=stage_id,participant_name,points,scoring_riders&order=stage_id.desc,points.desc,participant_name.asc');
    const picks=await get('public_predictions?select=stage_id,participant_name,rider_names&order=stage_id.desc,participant_name.asc');
    const sb=new Map(),pb=new Map(); scores.forEach(r=>{if(!sb.has(r.stage_id))sb.set(r.stage_id,[]);sb.get(r.stage_id).push(r);}); picks.forEach(r=>{if(!pb.has(r.stage_id))pb.set(r.stage_id,[]);pb.get(r.stage_id).push(r);});
    const daily=$('[data-daily-history]'),pred=$('[data-picks-history]');
    if(daily)daily.innerHTML=historic.map((s,i)=>{const rows=sb.get(s.id)||[];return `<details class="stage-result"${i===0?' open':''}><summary><span>Stage ${s.stage_number}${s.stage_name?` · ${esc(s.stage_name)}`:''}</span><span class="pill">Daily scores</span></summary><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Player</th><th>Scoring riders</th><th class="number">Points</th></tr></thead><tbody>${rows.map((r,n)=>`<tr><td class="rank">${n+1}</td><td>${participant(r.participant_name)}</td><td>${(r.scoring_riders||[]).map(x=>`${esc(x.rider_name)} <small>(+${x.points})</small>`).join(', ')||'—'}</td><td class="number"><strong>${r.points}</strong></td></tr>`).join('')||'<tr><td colspan="4" class="empty">No daily score recorded.</td></tr>'}</tbody></table></div></details>`}).join('');
    if(pred)pred.innerHTML=historic.map((s,i)=>{const rows=pb.get(s.id)||[],points=new Map((sb.get(s.id)||[]).map(x=>[x.participant_name,x.points]));return `<details class="stage-result"${i===0?' open':''}><summary><span>Stage ${s.stage_number}${s.stage_name?` · ${esc(s.stage_name)}`:''}</span><span class="pill">Predictions</span></summary><div class="picks-grid">${rows.map(r=>`<article class="pick-card"><h3><span class="participant-heading">${participant(r.participant_name)}</span> <span class="score-tag">${points.get(r.participant_name)??0} pts</span></h3><ol>${(r.rider_names||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ol></article>`).join('')||'<p class="empty">No predictions recorded.</p>'}</div></details>`}).join('');
  }catch(e){console.warn('Historic data unavailable:',e);}})();
})();