'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// ÉTAT
// ═══════════════════════════════════════════════════════════════════════════

const state = {
  coords:       null,
  nominatim:    null,
  streetFull:   '',
  streetType:   '',
  streetSimple: '',
  cityName:     '',
  plaques:      [],
  resultType:   '',
  wikiCache:    {},
  manualEdit:   false,
  leafletLoaded:false,
  mapInstance:  null,
};

// ═══════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  // Reset scroll des zones scrollables
  const sc = document.querySelector(`#${id} .home-scroll, #${id} .results-scroll, #${id} .about-scroll, #${id} .plaques-list-wrap`);
  if (sc) sc.scrollTop = 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSING RUE
// ═══════════════════════════════════════════════════════════════════════════

const PREFIXES = [
  [/^grande?\s+rue\b/i,'Grande Rue'],[/^avenue\b/i,'Avenue'],[/^boulevard\b/i,'Boulevard'],
  [/^allée[s]?\b/i,'Allée'],[/^impasse\b/i,'Impasse'],[/^place\b/i,'Place'],
  [/^passage\b/i,'Passage'],[/^cité\b/i,'Cité'],[/^villa\b/i,'Villa'],
  [/^chemin\b/i,'Chemin'],[/^route\b/i,'Route'],[/^square\b/i,'Square'],
  [/^voie\b/i,'Voie'],[/^ruelle\b/i,'Ruelle'],[/^sentier\b/i,'Sentier'],
  [/^sente\b/i,'Sente'],[/^traverse\b/i,'Traverse'],[/^esplanade\b/i,'Esplanade'],
  [/^cours\b/i,'Cours'],[/^quai\b/i,'Quai'],[/^pont\b/i,'Pont'],
  [/^rampe\b/i,'Rampe'],[/^montée\b/i,'Montée'],[/^côte\b/i,'Côte'],
  [/^domaine\b/i,'Domaine'],[/^résidence\b/i,'Résidence'],[/^promenade\b/i,'Promenade'],
  [/^rond[- ]point\b/i,'Rond-Point'],[/^hameau\b/i,'Hameau'],[/^rue\b/i,'Rue'],
];
const RE_ART = /^(de l'|de la |des |du |de |le |la |les |d'|l')/i;

function parseStreet(full) {
  let name = full.trim(), type = 'Rue';
  for (const [re, label] of PREFIXES) {
    if (re.test(name)) { name = name.replace(re,'').trim(); type = label; break; }
  }
  name = name.replace(RE_ART,'').trim();
  return { simplified: name || full, type };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════

const GENERIC = new Set([
  'beau','belle','bon','bonne','grand','grande','gros','grosse','haut','haute',
  'bas','basse','long','longue','large','vieux','vieille','nouveau','nouvelle',
  'petit','petite','joli','jolie',
  'amis','ami','amie','amour','bonheur','joie','espoir','rêve','paix',
  'liberté','égalité','fraternité','solidarité','justice','progrès','avenir','gloire',
  'fleur','fleurs','rose','roses','lilas','muguet','lavande','iris','violette',
  'chêne','platane','tilleul','peuplier','orme','pin','sapin','hêtre','charme','acacia',
  'bois','forêt','bosquet','prairie','pré','champ','jardin','parc',
  'soleil','lune','étoile','vent','nuage','pluie','neige',
  'rivière','ruisseau','source','fontaine','puits','étang','lac',
  'rocher','roche','pierre','grès','sable','vallée','vallon','coteau','colline',
  'moulin','moulins','four','forge','forges','église','chapelle','abbaye','temple',
  'château','ferme','grange','mairie','école','marché','halle','halles','lavoir',
  'aigle','lion','loup','renard','cerf','colombe','hirondelle','cygne',
  'blanc','blanche','rouge','vert','verte','bleu','bleue','doré','dorée','noir','noire',
  'tisserand','potier','tanneurs','tonneliers','charpentiers','maçons','cordonniers',
  'croix','calvaire','vignes','vigne','verger',
]);
const STOP = new Set(['les','des','rue','avenue','boulevard','de','du','la','le','sur','sous','aux']);

function classifyName(name) {
  const words = name.toLowerCase().split(/[\s\-']+/).filter(w => w.length > 2);
  if (!words.length) return 'unknown';
  const gRatio = words.filter(w => GENERIC.has(w)).length / words.length;
  if (gRatio >= 0.4) return 'generic';
  const hasProper = name.split(/[\s\-]+/).some(w => w.length > 2 && /^[A-ZÀ-Ÿ]/.test(w) && !STOP.has(w.toLowerCase()));
  return hasProper ? 'person' : 'concept';
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITAIRES
// ═══════════════════════════════════════════════════════════════════════════

function haversine(la1,lo1,la2,lo2) {
  const R=6371000, r=d=>d*Math.PI/180;
  const a=Math.sin(r(la2-la1)/2)**2+Math.cos(r(la1))*Math.cos(r(la2))*Math.sin(r(lo2-lo1)/2)**2;
  return R*2*Math.asin(Math.sqrt(a));
}
function fmtDist(m) { return m<1000?`${Math.round(m)} m`:`${(m/1000).toFixed(1)} km`; }

async function withTimeout(p,ms=8000) {
  return Promise.race([p, new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),ms))]);
}

function toast(msg) {
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('visible');
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('visible'),3200);
}

function linkRow(url,title,domain,icon) {
  return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="link-row">
    <span class="link-ico">${icon}</span>
    <span class="link-body"><span class="link-title">${title}</span><span class="link-domain">${domain}</span></span>
    <span class="link-arr">›</span>
  </a>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// API — NOMINATIM
// ═══════════════════════════════════════════════════════════════════════════

async function reverseGeocode(lat,lon) {
  const u=new URL('https://nominatim.openstreetmap.org/reverse');
  u.searchParams.set('format','json'); u.searchParams.set('lat',lat);
  u.searchParams.set('lon',lon); u.searchParams.set('zoom','18');
  u.searchParams.set('addressdetails','1'); u.searchParams.set('accept-language','fr');
  const r=await withTimeout(fetch(u,{headers:{'User-Agent':'StreetLore/2.0'}}),10000);
  if(!r.ok) throw new Error('Géocodage échoué');
  return r.json();
}

// ═══════════════════════════════════════════════════════════════════════════
// API — OVERPASS
// ═══════════════════════════════════════════════════════════════════════════

async function overpass(ql) {
  const r=await withTimeout(fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:'data='+encodeURIComponent(ql)}),10000);
  if(!r.ok) throw new Error('Overpass error');
  return r.json();
}

async function getEtymology(street,lat,lon) {
  try {
    const ql=`[out:json][timeout:6];way["name"="${street.replace(/"/g,'\\"')}"](around:120,${lat},${lon});out tags;`;
    const d=await overpass(ql);
    if(!d.elements?.length) return null;
    const t=d.elements[0].tags;
    return { wikidata:t['name:etymology:wikidata']||null, text:t['name:etymology']||null };
  } catch { return null; }
}

async function fetchOSMPlaques(lat,lon) {
  const ql=`[out:json][timeout:10];(node["historic"="memorial"](around:500,${lat},${lon});node["historic"="plaque"](around:500,${lat},${lon});node["memorial"~"plaque|blue_plaque"](around:500,${lat},${lon}););out body;`;
  const d=await overpass(ql);
  return (d.elements||[]).map(n=>{
    const t=n.tags||{};
    let photo=null;
    if(t.image) photo=t.image;
    else if(t.wikimedia_commons) photo=`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(t.wikimedia_commons.replace(/^File:/i,''))}?width=400`;
    let wikiUrl=null;
    if(t.wikipedia){const[lang,...rest]=t.wikipedia.split(':');wikiUrl=`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(rest.join(':'))}`;}
    return {id:`osm-${n.id}`,name:t.name||t.inscription?.split('\n')[0]||'Plaque commémorative',inscription:t.inscription||t.description||null,lat:n.lat,lon:n.lon,photo,wikiUrl,distance:haversine(lat,lon,n.lat,n.lon)};
  });
}

async function fetchOpenPlaques(lat,lon) {
  try {
    const d=0.0045;
    const url=`https://openplaques.org/plaques.json?box[sw_lat]=${(lat-d).toFixed(6)}&box[sw_lng]=${(lon-d).toFixed(6)}&box[ne_lat]=${(lat+d).toFixed(6)}&box[ne_lng]=${(lon+d).toFixed(6)}`;
    const r=await withTimeout(fetch(url),8000);
    if(!r.ok) return [];
    const data=await r.json();
    return (Array.isArray(data)?data:[]).filter(p=>p.latitude&&p.longitude).map(p=>({
      id:`op-${p.id}`,name:p.lead_subject?.name||p.inscription?.split('\n')[0]||'Plaque',
      inscription:p.inscription||null,lat:parseFloat(p.latitude),lon:parseFloat(p.longitude),
      photo:p.photos?.[0]?.large_url||null,wikiUrl:null,
      distance:haversine(lat,lon,parseFloat(p.latitude),parseFloat(p.longitude)),
    }));
  } catch { return []; }
}

async function fetchAllPlaques(lat,lon) {
  const [a,b]=await Promise.allSettled([fetchOSMPlaques(lat,lon),fetchOpenPlaques(lat,lon)]);
  const list=[...(a.status==='fulfilled'?a.value:[])];
  for(const p of (b.status==='fulfilled'?b.value:[])) {
    if(!list.some(m=>haversine(m.lat,m.lon,p.lat,p.lon)<30)) list.push(p);
  }
  return list.sort((a,b)=>a.distance-b.distance);
}

// ═══════════════════════════════════════════════════════════════════════════
// API — WIKIDATA → Wikipedia
// ═══════════════════════════════════════════════════════════════════════════

async function wikidataTitle(qid) {
  try {
    const r=await withTimeout(fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`),6000);
    if(!r.ok) return null;
    return (await r.json()).entities?.[qid]?.sitelinks?.frwiki?.title||null;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// API — WIKIPEDIA FR
// ═══════════════════════════════════════════════════════════════════════════

async function wikiSummary(title) {
  try {
    const r=await withTimeout(fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`),7000);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

async function wikiSearch(query) {
  try {
    const u=new URL('https://fr.wikipedia.org/w/api.php');
    u.searchParams.set('action','query'); u.searchParams.set('list','search');
    u.searchParams.set('srsearch',query); u.searchParams.set('format','json');
    u.searchParams.set('origin','*'); u.searchParams.set('srlimit','5');
    const r=await withTimeout(fetch(u),7000);
    if(!r.ok) return null;
    const results=(await r.json()).query?.search??[];
    for(const res of results){const s=await wikiSummary(res.title);if(s&&s.type!=='disambiguation')return s;}
    return results.length?wikiSummary(results[0].title):null;
  } catch { return null; }
}

function localContext(wiki,city) {
  if(!wiki?.extract||!city) return null;
  const norm=city.toLowerCase().replace(/-/g,' ');
  if(!wiki.extract.toLowerCase().includes(norm)) return null;
  const sentences=wiki.extract.split(/(?<=[.!?])\s+/);
  const rel=sentences.filter(s=>s.toLowerCase().includes(norm));
  return rel.length?rel.slice(0,2).join(' '):null;
}

async function smartSearch(simple,full,city,lat,lon) {
  // Couche 1 — étymologie OSM
  if(lat&&lon) {
    const etym=await getEtymology(full,lat,lon);
    if(etym?.wikidata){
      const title=await wikidataTitle(etym.wikidata);
      if(title){const wiki=await wikiSummary(title);if(wiki?.extract)return{src:'wikidata',wiki,ctx:localContext(wiki,city),etymText:etym.text};}
    }
    if(etym?.text) return{src:'etym-text',wiki:null,ctx:null,etymText:etym.text};
  }
  // Couche 2 — classification
  const type=classifyName(simple);
  if(type==='generic') return{src:'generic',wiki:null,ctx:null,etymText:null};
  // Couche 3 — Wikipedia
  const wiki=await wikiSearch(simple);
  if(wiki?.extract) return{src:'wikipedia',wiki,ctx:localContext(wiki,city),etymText:null};
  return{src:'notfound',wiki:null,ctx:null,etymText:null};
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTAGE — URL avec paramètres
// ═══════════════════════════════════════════════════════════════════════════

function buildShareUrl(name,type,city) {
  const base=window.location.origin+window.location.pathname;
  return `${base}?q=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}&city=${encodeURIComponent(city)}`;
}

async function doShare() {
  const name=document.getElementById('res-name').textContent;
  const city=document.getElementById('res-city').textContent;
  const url=buildShareUrl(name,state.resultType,city);
  const text=`${name}${city?' ('+city+')':''} — découvert avec StreetLore`;
  try {
    if(navigator.share){await navigator.share({title:`StreetLore · ${name}`,text,url});}
    else{await navigator.clipboard.writeText(url);toast('📋 Lien copié dans le presse-papier');}
  } catch{}
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDU — ACCUEIL
// ═══════════════════════════════════════════════════════════════════════════

function renderHome() {
  const addr=state.nominatim.address;
  const city=addr.city||addr.town||addr.village||addr.municipality||'';
  state.cityName=city;
  document.getElementById('home-type').textContent=state.streetType;
  document.getElementById('home-name').textContent=state.streetSimple;
  document.getElementById('home-city').textContent=city?`📍 ${[addr.city_district,city].filter(Boolean).join(' · ')}`:'';
  document.getElementById('sub-street').textContent=state.streetSimple;
  document.getElementById('sub-city').textContent=city;
  document.getElementById('manual-notice').classList.add('hidden');
  document.getElementById('plaques-badge').classList.add('hidden');
  document.getElementById('plaques-loading').classList.remove('hidden');
  showScreen('screen-home');

  fetchAllPlaques(state.coords.lat,state.coords.lon).then(pl=>{
    state.plaques=pl;
    document.getElementById('plaques-loading').classList.add('hidden');
    if(pl.length){
      document.getElementById('pb-label').textContent=`${pl.length} plaque${pl.length>1?'s':''} commémorative${pl.length>1?'s':''}`;
      document.getElementById('plaques-badge').classList.remove('hidden');
    }
  }).catch(()=>document.getElementById('plaques-loading').classList.add('hidden'));
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDU — RÉSULTATS
// ═══════════════════════════════════════════════════════════════════════════

function resetSkeleton() {
  document.getElementById('wiki-content').innerHTML='<div class="sk"></div><div class="sk"></div><div class="sk short"></div>';
  document.getElementById('links-content').innerHTML='<div class="sk"></div><div class="sk short"></div>';
  document.getElementById('nb-content').innerHTML='<div class="sk short"></div>';
  document.getElementById('source-badge').className='source-badge hidden';
  document.getElementById('local-card').classList.add('hidden');
}

async function renderResults(type, sharedName, sharedCity) {
  state.resultType=type;
  resetSkeleton();

  const isStreet=(type==='street');
  const name = sharedName||(isStreet?state.streetSimple:state.cityName);
  const city = sharedCity||state.cityName;
  const addr = state.nominatim?.address||{};

  document.getElementById('res-eyebrow').textContent=isStreet?state.streetType:'Ville';
  document.getElementById('res-name').textContent=name;
  document.getElementById('res-city').textContent=[addr.city_district,city].filter(Boolean).join(', ');
  document.getElementById('nb-card').style.display=isStreet?'':'none';

  showScreen('screen-results');

  // Quartier (rue seulement, synchrone)
  if(isStreet&&state.nominatim) {
    const items=[],seen=new Set();
    for(const[k,label] of [['neighbourhood','Quartier'],['suburb','Quartier'],['city_district','Arrondissement'],['city','Ville'],['town','Ville'],['village','Village'],['municipality','Commune'],['county','Département'],['postcode','Code postal']]){
      if(addr[k]&&!seen.has(label)){seen.add(label);items.push({label,value:addr[k]});}
      if(items.length>=4) break;
    }
    const nbEl=document.getElementById('nb-content');
    if(items.length){
      const grid=items.map(({label,value})=>`<div class="nb-item"><p class="nb-label">${label}</p><p class="nb-value">${value}</p></div>`).join('');
      const {lat,lon}=state.coords||{lat:0,lon:0};
      nbEl.innerHTML=`<div class="nb-grid">${grid}</div><a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}" target="_blank" rel="noopener" class="osm-link">🗺️ Voir sur OpenStreetMap</a>`;
    } else {
      nbEl.innerHTML='<p style="color:var(--muted);font-size:.9rem">Informations non disponibles.</p>';
    }
  }

  // Wikipedia (asynchrone)
  const cacheKey=`${type}:${name}`;
  if(!state.wikiCache[cacheKey]) {
    state.wikiCache[cacheKey]=isStreet
      ? smartSearch(name,state.streetFull||name,city,state.coords?.lat,state.coords?.lon)
      : wikiSearch(city).then(wiki=>({src:'wikipedia',wiki,ctx:null,etymText:null}));
  }

  let res;
  try { res=await state.wikiCache[cacheKey]; } catch { res={src:'notfound',wiki:null}; }
  applyWikiSection(res,name,city);
}

function applyWikiSection(res,name,city) {
  const badge=document.getElementById('source-badge');
  const wikiEl=document.getElementById('wiki-content');
  const linksEl=document.getElementById('links-content');

  // Badge
  if(res.src==='wikidata'){badge.className='source-badge ok';badge.textContent='✓ Source certifiée — étymologie OpenStreetMap / Wikidata';}
  else if(res.src==='wikipedia'){badge.className='source-badge info';badge.textContent='◎ Résultat Wikipedia — pertinence estimée';}
  else if(res.src==='generic'||res.src==='notfound'){badge.className='source-badge dim';badge.textContent=res.src==='generic'?'◌ Nom d\'usage local — pas de personnage identifié':'◌ Aucune information trouvée';}
  else badge.classList.add('hidden');

  // Étymologie textuelle sans Wikipedia
  if(res.src==='etym-text') {
    wikiEl.innerHTML=`<p class="wiki-text">${res.etymText}</p>`;
    linksEl.innerHTML=linkRow(`https://fr.wikipedia.org/w/index.php?search=${encodeURIComponent(name)}`,'Chercher sur Wikipédia','fr.wikipedia.org','📖')+
      linkRow(`https://www.google.com/search?q=${encodeURIComponent(name+' '+city+' histoire')}`,'Rechercher sur Google','google.com','🔍');
    return;
  }

  // Nom générique
  if(res.src==='generic') {
    wikiEl.innerHTML=`<div class="empty"><p class="empty-ico">🏷️</p><p>Cette rue porte un <strong>nom d'usage local</strong> (nature, métier, qualificatif) sans personnage ou événement historique précis.<br><br>Les archives municipales de ${city||'la ville'} peuvent en retracer l'origine.</p></div>`;
    linksEl.innerHTML=linkRow(`https://www.google.com/search?q=${encodeURIComponent('archives municipales '+city+' noms rues')}`,'Archives de '+city,'google.com','🗄️')+
      linkRow(`https://fr.wikipedia.org/w/index.php?search=${encodeURIComponent(name)}`,'Chercher sur Wikipédia','fr.wikipedia.org','📖');
    return;
  }

  // Rien trouvé
  if(!res.wiki?.extract) {
    wikiEl.innerHTML=`<div class="empty"><p class="empty-ico">🔍</p><p>Aucune information trouvée pour <strong>${name}</strong>.</p></div>`;
    linksEl.innerHTML=linkRow(`https://fr.wikipedia.org/w/index.php?search=${encodeURIComponent(name)}`,'Chercher sur Wikipédia','fr.wikipedia.org','📖')+
      linkRow(`https://www.google.com/search?q=${encodeURIComponent(name+' '+city)}`,'Rechercher sur Google','google.com','🔍');
    return;
  }

  // Résultat Wikipedia
  const wiki=res.wiki;
  const extract=wiki.extract.length>520?wiki.extract.slice(0,520).replace(/\s+\S*$/,'')+'…':wiki.extract;
  let html='';
  if(wiki.thumbnail?.source) html+=`<img src="${wiki.thumbnail.source}" class="wiki-thumb" alt="${wiki.title}" loading="lazy">`;
  if(wiki.title?.toLowerCase()!==name.toLowerCase()) html+=`<p class="wiki-origin">Article : <strong>${wiki.title}</strong></p>`;
  html+=`<p class="wiki-text">${extract}</p>`;
  wikiEl.innerHTML=html;

  // Contexte local
  if(res.ctx) {
    document.getElementById('local-title').textContent=`Lien avec ${city}`;
    document.getElementById('local-content').innerHTML=`<p class="local-text">${res.ctx}</p>`;
    document.getElementById('local-card').classList.remove('hidden');
  }

  // Liens
  const wikiUrl=wiki.content_urls?.mobile?.page||wiki.content_urls?.desktop?.page||'';
  const gQ=encodeURIComponent(`${name} ${city} histoire`);
  const mQ=encodeURIComponent(`${state.streetFull||name} ${city}`);
  linksEl.innerHTML=
    (wikiUrl?linkRow(wikiUrl,`${wiki.title} — Wikipédia`,'fr.wikipedia.org','📖'):'')+
    linkRow(`https://fr.wikipedia.org/w/index.php?search=${encodeURIComponent(name)}`,'Chercher sur Wikipédia','fr.wikipedia.org','🔎')+
    linkRow(`https://www.google.com/search?q=${gQ}`,'Rechercher sur Google','google.com','🔍')+
    linkRow(`https://www.google.com/maps/search/${mQ}`,'Voir sur Google Maps','maps.google.com','📍');
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDU — PLAQUES
// ═══════════════════════════════════════════════════════════════════════════

async function loadLeaflet() {
  if(state.leafletLoaded) return;
  await new Promise((res,rej)=>{
    const l=document.createElement('link');l.rel='stylesheet';l.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.appendChild(l);
    const s=document.createElement('script');s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);
  });
  state.leafletLoaded=true;
}

async function renderPlaques() {
  const {lat,lon}=state.coords;
  document.getElementById('pl-subtitle').textContent=`${state.plaques.length} trouvée${state.plaques.length>1?'s':''} · 500 m · ${state.cityName}`;
  showScreen('screen-plaques');

  // Carte
  try {
    await loadLeaflet();
    const mapEl=document.getElementById('map-container');
    if(state.mapInstance){state.mapInstance.remove();state.mapInstance=null;}
    const map=L.map(mapEl,{zoomControl:false}).setView([lat,lon],16);
    L.control.zoom({position:'bottomright'}).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:19}).addTo(map);
    const uIco=L.divIcon({className:'',html:'<div style="width:14px;height:14px;background:#f59e0b;border:3px solid #fff;border-radius:50%;box-shadow:0 0 8px rgba(245,158,11,.6)"></div>',iconAnchor:[7,7]});
    L.marker([lat,lon],{icon:uIco}).addTo(map).bindPopup('<strong>Vous êtes ici</strong>');
    const pIco=L.divIcon({className:'',html:'<div style="width:12px;height:12px;background:#3b82f6;border:2px solid #fff;border-radius:50%;"></div>',iconAnchor:[6,6]});
    for(const p of state.plaques) L.marker([p.lat,p.lon],{icon:pIco}).addTo(map).bindPopup(`<strong>${p.name}</strong><br><small>${fmtDist(p.distance)}</small>`);
    state.mapInstance=map;
  } catch {
    document.getElementById('map-container').innerHTML='<p style="color:var(--muted);padding:1rem;text-align:center;font-size:.85rem">Carte non disponible</p>';
  }

  // Liste
  const list=document.getElementById('plaques-list');
  if(!state.plaques.length){list.innerHTML='<div class="plaques-empty">🏅<br><br>Aucune plaque recensée dans un rayon de 500 m.</div>';return;}
  list.innerHTML=state.plaques.map((p,i)=>{
    const thumb=p.photo?`<img src="${p.photo}" class="pl-thumb" alt="${p.name}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\"pl-placeholder\\">🏅</div>'">`:`<div class="pl-placeholder">🏅</div>`;
    const detail=(p.photo?`<img src="${p.photo}" class="pd-photo" alt="${p.name}" loading="lazy">`:'')+
      (p.inscription?`<p class="pd-inscription">"${p.inscription.slice(0,300)}${p.inscription.length>300?'…':''}"</p>`:'')+
      (p.wikiUrl?`<a href="${p.wikiUrl}" target="_blank" rel="noopener" class="pd-wiki">📖 Voir sur Wikipédia</a>`:'');
    return `<div class="plaque-item" data-i="${i}">
      <div class="plaque-summary">${thumb}<div class="pl-info"><p class="pl-name">${p.name}</p><p class="pl-dist">${fmtDist(p.distance)}</p></div><span class="pl-chev">›</span></div>
      <div class="plaque-detail"><div class="pd-inner">${detail}</div></div>
    </div>`;
  }).join('');

  list.querySelectorAll('.plaque-summary').forEach(el=>{
    el.addEventListener('click',()=>{
      const item=el.closest('.plaque-item');
      const was=item.classList.contains('open');
      list.querySelectorAll('.plaque-item').forEach(i=>i.classList.remove('open'));
      if(!was){item.classList.add('open');const p=state.plaques[+item.dataset.i];if(state.mapInstance)state.mapInstance.flyTo([p.lat,p.lon],17,{duration:.8});}
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GPS + FLUX PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

function splashText(t){document.getElementById('splash-text').textContent=t;}
function splashError(msg){document.getElementById('splash-spinner').style.display='none';splashText(msg);document.getElementById('btn-retry').classList.remove('hidden');}

async function locateAndLoad() {
  state.wikiCache={}; state.plaques=[]; state.manualEdit=false;
  showScreen('screen-splash');
  document.getElementById('btn-retry').classList.add('hidden');
  document.getElementById('splash-spinner').style.display='';
  splashText('Localisation en cours…');

  if(!navigator.geolocation){splashError('Géolocalisation non supportée.');return;}

  navigator.geolocation.getCurrentPosition(
    async pos=>{
      const{latitude:lat,longitude:lon}=pos.coords;
      state.coords={lat,lon};
      splashText('Identification de la rue…');
      try {
        const data=await reverseGeocode(lat,lon);
        state.nominatim=data;
        const road=data.address?.road||data.address?.pedestrian||data.address?.footway||data.address?.path||'';
        if(!road){splashError('Aucune rue identifiée ici. Essayez depuis une rue.');return;}
        state.streetFull=road;
        const{simplified,type}=parseStreet(road);
        state.streetSimple=simplified; state.streetType=type;
        renderHome();
      } catch { splashError('Erreur réseau. Vérifiez votre connexion.'); }
    },
    err=>{
      if(err.code===1) splashError('Position refusée. Autorisez la géolocalisation dans les réglages.');
      else if(err.code===3) splashError('Délai GPS dépassé. Réessayez à l\'extérieur.');
      else splashError('Position indisponible. Réessayez.');
    },
    {enableHighAccuracy:true,timeout:13000,maximumAge:0}
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// OUVERTURE PAR URL PARTAGÉE (?q=...&type=...&city=...)
// ═══════════════════════════════════════════════════════════════════════════

function checkSharedUrl() {
  const p=new URLSearchParams(window.location.search);
  const q=p.get('q'), type=p.get('type')||'street', city=p.get('city')||'';
  if(!q) return false;
  // On affiche directement les résultats sans GPS
  state.streetSimple=q; state.streetFull=q; state.streetType=''; state.cityName=city;
  document.getElementById('res-eyebrow').textContent=type==='street'?'Rue':'Ville';
  document.getElementById('res-name').textContent=q;
  document.getElementById('res-city').textContent=city;
  document.getElementById('nb-card').style.display='none';
  resetSkeleton();
  state.resultType=type;
  showScreen('screen-results');
  const cacheKey=`${type}:${q}`;
  state.wikiCache[cacheKey]=type==='street'
    ? smartSearch(q,q,city,null,null)
    : wikiSearch(city).then(wiki=>({src:'wikipedia',wiki,ctx:null,etymText:null}));
  state.wikiCache[cacheKey].then(res=>applyWikiSection(res,q,city)).catch(()=>{});
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// ÉVÉNEMENTS
// ═══════════════════════════════════════════════════════════════════════════

document.getElementById('btn-retry').addEventListener('click', locateAndLoad);
document.getElementById('btn-relocate').addEventListener('click', locateAndLoad);
document.getElementById('btn-street').addEventListener('click', ()=>renderResults('street'));
document.getElementById('btn-city').addEventListener('click',   ()=>renderResults('city'));
document.getElementById('btn-plaques').addEventListener('click', renderPlaques);
document.getElementById('btn-about').addEventListener('click',  ()=>showScreen('screen-about'));
document.getElementById('btn-back-results').addEventListener('click', ()=>showScreen('screen-home'));
document.getElementById('btn-back-plaques').addEventListener('click', ()=>showScreen('screen-home'));
document.getElementById('btn-back-about').addEventListener('click',   ()=>showScreen('screen-home'));
document.getElementById('btn-share').addEventListener('click', doShare);

// ── Édition manuelle ─────────────────────────────────────────────────────
document.getElementById('btn-edit').addEventListener('click',()=>{
  const f=document.getElementById('edit-form');
  const open=f.classList.toggle('open');
  if(open){const i=document.getElementById('edit-input');i.value=state.streetSimple;i.focus();i.select();}
});
document.getElementById('btn-edit-cancel').addEventListener('click',()=>document.getElementById('edit-form').classList.remove('open'));
document.getElementById('edit-input').addEventListener('keydown',e=>{if(e.key==='Enter')applyEdit();if(e.key==='Escape')document.getElementById('edit-form').classList.remove('open');});
document.getElementById('btn-edit-ok').addEventListener('click', applyEdit);

function applyEdit(){
  const raw=document.getElementById('edit-input').value.trim();
  if(!raw) return;
  const{simplified,type}=parseStreet(raw);
  state.streetSimple=simplified; state.streetType=type; state.streetFull=raw;
  state.manualEdit=true; state.wikiCache={};
  document.getElementById('home-type').textContent=type;
  document.getElementById('home-name').textContent=simplified;
  document.getElementById('sub-street').textContent=simplified;
  document.getElementById('edit-form').classList.remove('open');
  document.getElementById('manual-notice').classList.remove('hidden');
  document.getElementById('plaques-badge').classList.add('hidden');
  document.getElementById('plaques-loading').classList.add('hidden');
  toast(`✏️ Nom modifié : ${simplified}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE WORKER
// ═══════════════════════════════════════════════════════════════════════════

if('serviceWorker'in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════

if(!checkSharedUrl()) locateAndLoad();
