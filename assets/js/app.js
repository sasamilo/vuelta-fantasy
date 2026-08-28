(() => {
  const cfg = window.FANTASY_CONFIG || {};
  const route = window.VUELTA_ROUTE || {};
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const images={sasa:'https://thinktank.preskok.si/wp-content/uploads/2026/02/Sasa-Milo-768x768.webp',lovro:'https://i.imgur.com/7OdZQyk.jpg',robert:'https://preskok.si/wp-content/uploads/2025/08/Robert-Golob.webp',samo:'https://autobrief.io/wp-content/uploads/2025/09/Samo_Pavlovic-portfolio.webp',matej:'https://preskok.si/wp-content/uploads/2025/08/Matej-Klinc.webp',blaz:'https://preskok.si/wp-content/uploads/2026/05/Blaz-Lipar.webp'};
  const participant=n=>{const name=String(n||''),key=name.trim().split(/\s+/)[0].replace(/[.,]/g,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),img=images[key];return img?'<span class="participant-cell"><img class="participant-avatar" src="'+img+'" alt="'+esc(name)+'" loading="lazy"><span>'+esc(name)+'</span></span>':esc(name)};
  const empty=(sel,cols,msg)=>{const e=$(sel);if(e)e.innerHTML='<tr><td colspan="'+cols+'" class="empty">'+esc(msg)+'</td></tr>';};
  if(!cfg.supabaseUrl||!cfg.supabaseAnonKey){empty('[data-leaderboard]',4,'Configure Supabase to publish standings.');return;}
  const headers={apikey:cfg.supabaseAnonKey,Authorization:'Bearer '+cfg.supabaseAnonKey};
  const get=async path=>{const r=await fetch(cfg.supabaseUrl+'/rest/v1/'+path,{headers});if(!r.ok)throw Error(r.status+': '+await r.text());return r.json();};
  const initials=n=>{const p=String(n||'').trim().split(/\s+/).filter(Boolean);return p.length?(p[0][0]+(p.length>1?p[p.length-1][0]:'')).toUpperCase():'?';};
  const fallback=n=>'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="#d9ff43"/><text x="150" y="220" text-anchor="middle" font-family="Arial" font-size="88" font-weight="900" fill="#11231f">'+esc(initials(n))+'</text></svg>');
  async function main(){
    const leaders=await get('leaderboard?select=*&order=total_points.desc,participant_name.asc');
    const stages=await get('public_stages?select=*&order=stage_number.desc&limit=1');
    if(leaders.length)$('[data-leaderboard]').innerHTML=leaders.map((x,i)=>'<tr><td class="rank">'+(i+1)+'</td><td>'+participant(x.participant_name)+'</td><td class="number"><strong>'+x.total_points+'</strong></td><td class="number">'+x.stages_scored+'</td></tr>').join('');else empty('[data-leaderboard]',4,'No scored predictions yet.');
    if(!stages.length)return;
    const stage=stages[0],id=stage.id,n=Number(stage.stage_number);
    const results=await get('public_rider_results?select=stage_id,stage_number,stage_name,finish_position,rider_name,rider_url,rider_image,points&stage_id=eq.'+encodeURIComponent(id)+'&order=finish_position.asc');
    const table=$('[data-stage-results]');
    if(table)table.innerHTML=results.length?'<details class="stage-result" open><summary><span>Stage '+n+(stage.stage_name?' · '+esc(stage.stage_name):'')+'</span><span class="pill">Top 30</span></summary><div class="table-wrap"><table><thead><tr><th>Place</th><th>Rider</th><th class="number">Points</th></tr></thead><tbody>'+results.map(r=>'<tr><td class="rank">'+r.finish_position+'</td><td>'+esc(r.rider_name)+'</td><td class="number"><strong>'+r.points+'</strong></td></tr>').join('')+'</tbody></table></div></details>':'<p class="empty">No official results are available for the current stage.</p>';
    const routeStage=route.stages?.[n],winner=results.find(r=>Number(r.finish_position)===1);
    const count=$('[data-stage-count]');if(count)count.textContent=n+' stage'+(n===1?'':'s')+' scored';
    if(routeStage){if($('[data-latest-eyebrow]'))$('[data-latest-eyebrow]').textContent='Stage '+n;if($('[data-latest-title]'))$('[data-latest-title]').textContent=routeStage.start+' → '+routeStage.finish;if($('[data-latest-meta]'))$('[data-latest-meta]').textContent=routeStage.type+' · '+routeStage.distance+' · '+routeStage.date;}
    if(winner){const card=$('[data-stage-winner]'),img=$('[data-winner-image]');if(card&&img){const fb=fallback(winner.rider_name);img.onerror=()=>{img.onerror=null;img.src=fb;};img.src=winner.rider_image||fb;img.alt=winner.rider_name;const nm=$('[data-winner-name]'),tm=$('[data-winner-team]');if(nm)nm.textContent=winner.rider_name;if(tm)tm.textContent=routeStage?.winner?.team||'';card.href=winner.rider_url||'#';card.target='_blank';card.rel='noopener';card.hidden=false;}}
    const scores=await get('stage_scores?select=*&stage_id=eq.'+encodeURIComponent(id)+'&order=points.desc,participant_name.asc');
    const daily=$('[data-daily]');if(daily)daily.innerHTML=scores.length?scores.map((x,i)=>'<tr><td class="rank">'+(i+1)+'</td><td>'+participant(x.participant_name)+'</td><td>'+((x.scoring_riders||[]).map(r=>esc(r.rider_name)+' <small>(+'+r.points+')</small>').join(', ')||'—')+'</td><td class="number"><strong>'+x.points+'</strong></td></tr>').join(''):'<tr><td colspan="4" class="empty">No daily scores were recorded for this stage.</td></tr>';
    const picks=await get('public_predictions?select=participant_name,rider_names,stage_id&stage_id=eq.'+encodeURIComponent(id)+'&order=participant_name.asc');
    const points=new Map(scores.map(x=>[x.participant_name,x.points])),pred=$('[data-predictions]');if(pred)pred.innerHTML=picks.length?picks.map(x=>'<article class="pick-card"><h3><span class="participant-heading">'+participant(x.participant_name)+'</span> <span class="score-tag">'+(points.get(x.participant_name)??0)+' pts</span></h3><ol>'+((x.rider_names||[]).map(r=>'<li>'+esc(r)+'</li>').join(''))+'</ol></article>').join(''):'<p class="empty">No predictions recorded for this stage.</p>';
  }
  main().catch(e=>{console.error('Vuelta Fantasy data load failed:',e);empty('[data-leaderboard]',4,'Scores are temporarily unavailable.');empty('[data-daily]',4,'Scores are temporarily unavailable.');});
})();
