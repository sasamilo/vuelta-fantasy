(() => {
  const cfg = window.FANTASY_CONFIG || {};
  const route = window.VUELTA_ROUTE || {};
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const participantImages={sasa:'https://thinktank.preskok.si/wp-content/uploads/2026/02/Sasa-Milo-768x768.webp',lovro:'https://i.imgur.com/7OdZQyk.jpg',robert:'https://preskok.si/wp-content/uploads/2025/08/Robert-Golob.webp',samo:'https://autobrief.io/wp-content/uploads/2025/09/Samo_Pavlovic-portfolio.webp',matej:'https://preskok.si/wp-content/uploads/2025/08/Matej-Klinc.webp',blaz:'https://preskok.si/wp-content/uploads/2026/05/Blaz-Lipar.webp'};
  const first=n=>String(n||'').trim().split(/\s+/)[0].replace(/[.,]/g,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const participant=n=>{const x=esc(n),i=participantImages[first(n)];return i?'<span class="participant-cell"><img class="participant-avatar" src="'+i+'" alt="'+x+'" loading="lazy"> <span>'+x+'</span></span>':x;};
  const empty=(s,c,t)=>{const e=$(s);if(e)e.innerHTML='<tr><td colspan="'+c+'" class="empty">'+esc(t)+'</td></tr>';};
  if(cfg.googleFormUrl){const e=$('[data-form-link]');if(e){e.href=cfg.googleFormUrl;e.hidden=false;}}
  if(!cfg.supabaseUrl||!cfg.supabaseAnonKey){empty('[data-leaderboard]',4,'Configure Supabase to publish standings.');return;}
  const headers={apikey:cfg.supabaseAnonKey,Authorization:'Bearer '+cfg.supabaseAnonKey};
  const get=async p=>{const r=await fetch(cfg.supabaseUrl+'/rest/v1/'+p,{headers});if(!r.ok)throw Error(r.status+': '+await r.text());return r.json();};
  const fallback=n=>{const p=String(n||'').trim().split(/\s+/).filter(Boolean),ini=p.length?(p[0][0]+(p.length>1?p[p.length-1][0]:'' )).toUpperCase():'?';return 'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="#d9ff43"/><text x="150" y="220" text-anchor="middle" font-family="Arial,sans-serif" font-size="88" font-weight="900" fill="#11231f">'+esc(ini)+'</text></svg>');};

  async function loadLeaderboard(){try{const rows=await get('leaderboard?select=*&order=total_points.desc,participant_name.asc'),e=$('[data-leaderboard]');if(e)e.innerHTML=rows.length?rows.map((x,i)=>'<tr><td class="rank">'+(i+1)+'</td><td>'+participant(x.participant_name)+'</td><td class="number"><strong>'+x.total_points+'</strong></td><td class="number">'+x.stages_scored+'</td></tr>').join(''):'<tr><td colspan="4" class="empty">No scored predictions yet.</td></tr>';}catch(e){console.error('Leaderboard:',e);empty('[data-leaderboard]',4,'Scores are temporarily unavailable.');}}

  async function loadCurrentStage(){
    let stages;try{stages=await get('public_stages?select=id,stage_number,stage_name,result_date,pcs_url&order=stage_number.desc&limit=1');}catch(e){console.error('Stages:',e);const x=$('[data-stage-results]');if(x)x.innerHTML='<p class="empty">Official results are temporarily unavailable.</p>';return;}
    if(!stages.length)return;
    const stage=stages[0],stageId=stage.id,n=Number(stage.stage_number)||0;
    const c=$('[data-stage-count]');if(c)c.textContent=n+' stage'+(n===1?'':'s')+' scored';
    let results=[];try{results=await get('public_rider_results?select=stage_id,stage_number,stage_name,finish_position,rider_name,rider_url,rider_image,points&stage_id=eq.'+encodeURIComponent(stageId)+'&order=finish_position.asc');}catch(e){console.error('Stage results:',e);}
    const container=$('[data-stage-results]');
    if(container){if(!results.length)container.innerHTML='<p class="empty">No official results are available for the current stage.</p>';else container.innerHTML='<details class="stage-result" open><summary><span>Stage '+n+(stage.stage_name?' · '+esc(stage.stage_name):'')+'</span><span class="pill">Top 30</span></summary><div class="table-wrap"><table><thead><tr><th>Place</th><th>Rider</th><th class="number">Points</th></tr></thead><tbody>'+results.map(r=>'<tr><td class="rank">'+r.finish_position+'</td><td>'+esc(r.rider_name)+'</td><td class="number"><strong>'+r.points+'</strong></td></tr>').join('')+'</tbody></table></div></details>';}
    const routeStage=route.stages?.[n],winner=results.find(r=>Number(r.finish_position)===1);
    if(routeStage){const a=$('[data-latest-eyebrow]'),b=$('[data-latest-title]'),d=$('[data-latest-meta]'),l=$('[data-latest-link]');if(a)a.textContent='Stage '+n;if(b)b.textContent=routeStage.start+' → '+routeStage.finish;if(d)d.textContent=routeStage.type+' · '+routeStage.distance+' · '+routeStage.date;if(l){l.href=routeStage.official_url||stage.pcs_url||'#';l.hidden=false;}}
    if(winner){const card=$('[data-stage-winner]'),img=$('[data-winner-image]');if(card&&img){const fb=fallback(winner.rider_name);img.onerror=()=>{img.onerror=null;img.src=fb;};img.src=winner.rider_image||fb;img.alt=winner.rider_name;const name=$('[data-winner-name]'),team=$('[data-winner-team]');if(name)name.textContent=routeStage?.winner?.display_name||winner.rider_name;if(team)team.textContent=routeStage?.winner?.team||'';card.href=winner.rider_url||'#';card.target='_blank';card.rel='noopener';card.hidden=false;}}
    const label=$('[data-picks-stage]');if(label)label.textContent='Stage '+n;
    let scores=[];try{scores=await get('stage_scores?select=*&stage_id=eq.'+encodeURIComponent(stageId)+'&order=points.desc,participant_name.asc');}catch(e){console.error('Daily scores:',e);}
    let picks=[];try{picks=await get('public_predictions?select=participant_name,rider_names,stage_id&stage_id=eq.'+encodeURIComponent(stageId)+'&order=participant_name.asc');}catch(e){console.error('Predictions:',e);}
    const daily=$('[data-daily]');if(daily)daily.innerHTML=scores.length?scores.map((x,i)=>'<tr><td class="rank">'+(i+1)+'</td><td>'+participant(x.participant_name)+'</td><td>'+((x.scoring_riders||[]).map(r=>esc(r.rider_name)+' <small>(+'+r.points+')</small>').join(', ')||'—')+'</td><td class="number"><strong>'+x.points+'</strong></td></tr>').join(''):'<tr><td colspan="4" class="empty">No daily scores were recorded for this stage.</td></tr>';
    const byName=new Map(scores.map(x=>[x.participant_name,x.points])),pred=$('[data-predictions]');if(pred)pred.innerHTML=picks.length?picks.map(x=>'<article class="pick-card"><h3><span class="participant-heading">'+participant(x.participant_name)+'</span> <span class="score-tag">'+(byName.get(x.participant_name)??0)+' pts</span></h3><ol>'+((x.rider_names||[]).map(r=>'<li>'+esc(r)+'</li>').join(''))+'</ol></article>').join(''):'<p class="empty">No predictions recorded for this stage.</p>';
  }
  loadLeaderboard();
  loadCurrentStage();
})();
