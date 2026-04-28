'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG IA
// ═══════════════════════════════════════════════════════════════════════════

const GEMINI_KEY = 'AIzaSyAfYRPiI9YfD2jxY9rzXmnha4RV0PXW9LQ';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;

// ═══════════════════════════════════════════════════════════════════════════
// ÉTAT
// ═══════════════════════════════════════════════════════════════════════════

const state = {
  coords:        null,
  nominatim:     null,
  streetFull:    '',
  streetType:    '',
  streetSimple:  '',
  cityName:      '',
  plaques:       [],
  resultType:    '',
  wikiCache:     {},
  manualEdit:    false,
  leafletLoaded: false,
  mapInstance:   null,
};

// ═══════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  el.classList.add('active');
  el.scrollTop = 0;
  const inner = el.querySelector('.plaques-list-wrap');
  if (inner) inner.scrollTop = 0;
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
    if (re.test(name)) { name = name.replace(re, '').trim(); type = label; break; }
  }
  name = name.replace(RE_ART, '').trim();
  return { simplified: name || full, type };
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITAIRES
// ═══════════════════════════════════════════════════════════════════════════

function haversine(la1,lo1,la2,lo2) {
  const R=6371000,r=d=>d*Math.PI/180;
  const a=Math.sin(r(la2-la1)/2)**2+Math.cos(r(la1))*Math.cos(r(la2))*Math.sin(r(lo2-lo1)/2)**2;
  return R*2*Math.asin(Math.sqrt(a));
}
function fmtDist(m){return m<1000?`${Math.round(m)} m`:`${(m/1000).toFixed(1)} km`;}

async function withTimeout(p,ms=8000){
  return Promise.race([p,new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),ms))]);
}

function toast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('visible');
  clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('visible'),3200);
}

function linkRow(url,title,domain,icon){
  return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="link-row">
    <span class="link-ico">${icon}</span>
    <span class="link-body"><span class="link-title">${title}</span><span class="link-domain">${domain}</span></span>
    <span class="link-arr">›</span>
  </a>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// API — GEMINI
// ═══════════════════════════════════════════════════════════════════════════

async function callGemini(full, city, mode='street') {
  try {
    let prompt;
    if (mode==='city') {
      prompt=`En 3 à 4 phrases en français, présente les origines et l'histoire de la ville de ${city} : son étymologie, sa fondation, son développement et ce qui la caractérise historiquement. Sois factuel et concis.`;
    } else {
      prompt=`En 3 à 4 phrases en français, explique l'histoire et l'origine du nom "${full}"${city?` à ${city}`:''}.`+
        ` Concentre-toi sur la personne, l'événement ou le lieu qui a donné son nom à cette rue.`+
        ` Si c'est une personne, précise qui elle était et son lien avec cette ville ou région.`+
        ` Sois factuel, précis et concis. Ne décris pas la rue elle-même.`;
    }
    const r=await withTimeout(fetch(GEMINI_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        contents:[{parts:[{text:prompt}]}],
        generationConfig:{temperature:0.2,maxOutputTokens:300},
      }),
    }),15000);
    if(!r.ok){
      const err=await r.json().catch(()=>({}));
      const msg=err?.error?.message||`HTTP ${r.status}`;
      console.error('Gemini error:',r.status,msg);
      toast(`⚠️ IA: ${msg.slice(0,60)}`);
      return null;
    }
    const data=await r.json();
    const text=data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()||null;
    if(!text) console.warn('Gemini: réponse vide',data);
    return text;
  }catch(e){
    console.error('Gemini exception:',e);
    toast(`⚠️ IA: ${e.message?.slice(0,60)||'erreur réseau'}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// API — NOMINATIM
// ═══════════════════════════════════════════════════════════════════════════

async function reverseGeocode(lat,lon){
  const u=new URL('https://nominatim.openstreetmap.org/reverse');
  u.searchParams.set('format','json');u.searchParams.set('lat',lat);
  u.searchParams.set('lon',lon);u.searchParams.set('zoom','18');
  u.searchParams.set('addressdetails','1');u.searchParams.set('accept-language','fr');
  const r=await withTimeout(fetch(u,{headers:{'User-Agent':'StreetLore/2.3'}}),10000);
  if(!r.ok) throw new Error('Géocodage échoué');
  return r.json();
}

// ═══════════════════════════════════════════════════════════════════════════
// API — OVERPASS
// ═══════════════════════════════════════════════════════════════════════════

async function overpass(ql){
  const r=await withTimeout(fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:'data='+encodeURIComponent(ql)}),12000);
  if(!r.ok) throw new Error('Overpass error');
  return r.json();
}

async function fetchNearbyStreets(lat,lon){
  try{
    const ql=`[out:json][timeout:8];way["highway"]["name"](around:80,${lat},${lon});out tags;`;
    const d=await overpass(ql);
    return[...new Set((d.elements||[]).map(e=>e.tags?.name).filter(Boolean))];
  }catch{return[];}
}

async function getEtymology(street,lat,lon){
  try{
    const ql=`[out:json][timeout:6];way["name"="${street.replace(/"/g,'\\"')}"](around:120,${lat},${lon});out tags;`;
    const d=await overpass(ql);
    if(!d.elements?.length) return null;
    const t=d.elements[0].tags;
    return{
      wikidata: t['name:etymology:wikidata']||null,
      wikipedia:t['wikipedia']||t['name:etymology:wikipedia']||null,
    };
  }catch{return null;}
}

// ═══════════════════════════════════════════════════════════════════════════
// PHOTOS PLAQUES
// ═══════════════════════════════════════════════════════════════════════════

async function commonsFirstPhoto(category){
  try{
    const cat=category.replace(/^Category:/i,'');
    const u=new URL('https://commons.wikimedia.org/w/api.php');
    u.searchParams.set('action','query');u.searchParams.set('list','categorymembers');
    u.searchParams.set('cmtitle',`Category:${cat}`);u.searchParams.set('cmtype','file');
    u.searchParams.set('cmlimit','1');u.searchParams.set('format','json');u.searchParams.set('origin','*');
    const r=await withTimeout(fetch(u),5000);
    if(!r.ok) return null;
    const file=(await r.json()).query?.categorymembers?.[0]?.title;
    if(!file) return null;
    return`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/^File:/i,''))}?width=400`;
  }catch{return null;}
}

async function wikiThumbFromUrl(wikiUrl){
  try{
    const m=wikiUrl.match(/\/wiki\/(.+)$/);
    if(!m) return null;
    const s=await wikiSummary(decodeURIComponent(m[1].replace(/_/g,' ')));
    return s?.thumbnail?.source||null;
  }catch{return null;}
}

async function enrichPlaquesPhotos(list){
  const toEnrich=list.filter(p=>!p.photo&&(p._commonsCategory||p.wikiUrl));
  await Promise.allSettled(toEnrich.map(async p=>{
    if(p._commonsCategory) p.photo=await commonsFirstPhoto(p._commonsCategory);
    if(!p.photo&&p.wikiUrl) p.photo=await wikiThumbFromUrl(p.wikiUrl);
    delete p._commonsCategory;
  }));
  list.forEach(p=>delete p._commonsCategory);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════
// API — PLAQUES (500 m)
// ═══════════════════════════════════════════════════════════════════════════

async function fetchOSMPlaques(lat,lon){
  const ql=`[out:json][timeout:10];(
    node["historic"="memorial"](around:500,${lat},${lon});
    node["historic"="plaque"](around:500,${lat},${lon});
    node["historic"="monument"](around:500,${lat},${lon});
    node["memorial"~"plaque|blue_plaque|stele|bust|statue"](around:500,${lat},${lon});
    node["tourism"="artwork"]["artwork_type"~"statue|bust|relief|plaque"](around:500,${lat},${lon});
  );out body;`;
  const d=await overpass(ql);
  return(d.elements||[]).map(n=>{
    const t=n.tags||{};
    const commonsVal=t.wikimedia_commons||'';
    let photo=null,_commonsCategory=null;
    if(t.image) photo=t.image;
    else if(commonsVal&&!commonsVal.startsWith('Category:'))
      photo=`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(commonsVal.replace(/^File:/i,''))}?width=400`;
    else if(commonsVal.startsWith('Category:'))
      _commonsCategory=commonsVal;
    let wikiUrl=null;
    if(t.wikipedia){const[lang,...rest]=t.wikipedia.split(':');wikiUrl=`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(rest.join(':'))}`;}
    return{id:`osm-${n.id}`,name:t.name||t.inscription?.split('\n')[0]||'Plaque commémorative',
      inscription:t.inscription||t.description||null,lat:n.lat,lon:n.lon,photo,wikiUrl,_commonsCategory,
      distance:haversine(lat,lon,n.lat,n.lon)};
  });
}

async function fetchWikidataPlaques(lat,lon){
  try{
    const sparql=`
SELECT DISTINCT ?item ?label ?coord ?image ?article WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "0.5" .
  }
  { ?item wdt:P31 wd:Q840490 } UNION { ?item wdt:P31 wd:Q4989906 } UNION
  { ?item wdt:P31 wd:Q5003624 } UNION { ?item wdt:P31 wd:Q1288575 } UNION
  { ?item wdt:P31 wd:Q4330316 }
  OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) = "fr") }
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> . }
} LIMIT 40`;
    const url=`https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
    const r=await withTimeout(fetch(url,{headers:{'Accept':'application/sparql-results+json','User-Agent':'StreetLore/2.3'}}),14000);
    if(!r.ok) return[];
    const data=await r.json();
    return(data.results?.bindings||[]).map(b=>{
      const m=b.coord?.value?.match(/Point\(([^\s]+)\s+([^\)]+)\)/);
      if(!m) return null;
      const pLon=parseFloat(m[1]),pLat=parseFloat(m[2]);
      const qid=b.item.value.split('/').pop();
      let photo=null;
      if(b.image?.value){
        const fn=b.image.value.split('/Special:FilePath/')[1]||b.image.value.split('/').pop();
        photo=`https://commons.wikimedia.org/wiki/Special:FilePath/${fn}?width=400`;
      }
      return{id:`wd-${qid}`,name:b.label?.value||'Plaque commémorative',inscription:null,
        lat:pLat,lon:pLon,photo,wikiUrl:b.article?.value||null,_commonsCategory:null,
        distance:haversine(lat,lon,pLat,pLon)};
    }).filter(Boolean);
  }catch{return[];}
}

async function fetchOpenPlaques(lat,lon){
  try{
    const d=0.0045;
    const url=`https://openplaques.org/plaques.json?box[sw_lat]=${(lat-d).toFixed(6)}&box[sw_lng]=${(lon-d).toFixed(6)}&box[ne_lat]=${(lat+d).toFixed(6)}&box[ne_lng]=${(lon+d).toFixed(6)}`;
    const r=await withTimeout(fetch(url),8000);
    if(!r.ok) return[];
    const data=await r.json();
    return(Array.isArray(data)?data:[]).filter(p=>p.latitude&&p.longitude).map(p=>({
      id:`op-${p.id}`,name:p.lead_subject?.name||p.inscription?.split('\n')[0]||'Plaque',
      inscription:p.inscription||null,lat:parseFloat(p.latitude),lon:parseFloat(p.longitude),
      photo:p.photos?.[0]?.large_url||null,wikiUrl:null,_commonsCategory:null,
      distance:haversine(lat,lon,parseFloat(p.latitude),parseFloat(p.longitude))}));
  }catch{return[];}
}

async function fetchAllPlaques(lat,lon){
  const[a,b,c]=await Promise.allSettled([fetchOSMPlaques(lat,lon),fetchWikidataPlaques(lat,lon),fetchOpenPlaques(lat,lon)]);
  const list=[...(a.status==='fulfilled'?a.value:[])];
  const dedup=p=>!list.some(m=>haversine(m.lat,m.lon,p.lat,p.lon)<30);
  for(const p of(b.status==='fulfilled'?b.value:[])) if(dedup(p)) list.push(p);
  for(const p of(c.status==='fulfilled'?c.value:[])) if(dedup(p)) list.push(p);
  const sorted=list.sort((a,b)=>a.distance-b.distance);
  await enrichPlaquesPhotos(sorted);
  return sorted;
}

// ═══════════════════════════════════════════════════════════════════════════
// API — WIKIDATA + WIKIPEDIA (photo et lien uniquement)
// ═══════════════════════════════════════════════════════════════════════════

async function wikidataTitle(qid){
  try{
    const r=await withTimeout(fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`),6000);
    if(!r.ok) return null;
    return(await r.json()).entities?.[qid]?.sitelinks?.frwiki?.title||null;
  }catch{return null;}
}

async function wikiSummary(title){
  try{
    const r=await withTimeout(fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`),7000);
    return r.ok?r.json():null;
  }catch{return null;}
}

// Recherche Wikipedia — retourne un article avec thumbnail et URL
async function findBestWikiArticle(simple,full,city,lat,lon){
  // 1. Étymologie OSM via Wikidata
  if(lat&&lon){
    const etym=await getEtymology(full,lat,lon);
    if(etym?.wikidata){
      const title=await wikidataTitle(etym.wikidata);
      if(title){const w=await wikiSummary(title);if(w?.extract) return w;}
    }
    if(etym?.wikipedia){
      const[lang,...rest]=etym.wikipedia.split(':');
      if(lang==='fr'){const w=await wikiSummary(rest.join(':'));if(w?.extract) return w;}
    }
  }
  // 2. Page dédiée à la rue
  if(city){const w=await wikiSummary(`${full} (${city})`);if(w?.extract&&w.type!=='disambiguation') return w;}
  const w2=await wikiSummary(full);
  if(w2?.extract&&w2.type!=='disambiguation') return w2;
  // 3. Recherche par nom simplifié
  try{
    const u=new URL('https://fr.wikipedia.org/w/api.php');
    u.searchParams.set('action','query');u.searchParams.set('list','search');
    u.searchParams.set('srsearch',simple);u.searchParams.set('format','json');
    u.searchParams.set('origin','*');u.searchParams.set('srlimit','3');
    const r=await withTimeout(fetch(u),6000);
    if(!r.ok) return null;
    const results=(await r.json()).query?.search??[];
    for(const res of results){
      const s=await wikiSummary(res.title);
      if(s&&s.type!=='disambiguation') return s;
    }
  }catch{}
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// RECHERCHE PRINCIPALE — IA + Wikipedia en parallèle
// ═══════════════════════════════════════════════════════════════════════════

async function fetchStreetInfo(simple,full,city,lat,lon){
  const[aiRes,wikiRes]=await Promise.allSettled([
    callGemini(full,city,'street'),
    findBestWikiArticle(simple,full,city,lat,lon),
  ]);
  return{
    aiText: aiRes.status==='fulfilled'?aiRes.value:null,
    wiki:   wikiRes.status==='fulfilled'?wikiRes.value:null,
  };
}

async function fetchCityInfo(city){
  const[aiRes,wikiRes]=await Promise.allSettled([
    callGemini(null,city,'city'),
    wikiSummary(city),
  ]);
  return{
    aiText: aiRes.status==='fulfilled'?aiRes.value:null,
    wiki:   wikiRes.status==='fulfilled'?wikiRes.value:null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTAGE
// ═══════════════════════════════════════════════════════════════════════════

function buildShareUrl(name,type,city){
  const base=window.location.origin+window.location.pathname;
  return`${base}?q=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}&city=${encodeURIComponent(city)}`;
}

async function doShare(){
  const name=document.getElementById('res-name').textContent;
  const city=document.getElementById('res-city').textContent;
  const url=buildShareUrl(name,state.resultType,city);
  const text=`${name}${city?' ('+city+')':''} — découvert avec StreetLore`;
  try{
    if(navigator.share){await navigator.share({title:`StreetLore · ${name}`,text,url});}
    else{await navigator.clipboard.writeText(url);toast('📋 Lien copié dans le presse-papier');}
  }catch{}
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDU — SÉLECTION RUE (intersection)
// ═══════════════════════════════════════════════════════════════════════════

function showStreetSelection(streets){
  const container=document.getElementById('street-choices');
  container.innerHTML=streets.map(name=>{
    const{simplified,type}=parseStreet(name);
    return`<button class="street-choice" data-full="${name.replace(/"/g,'&quot;')}">
      <span class="sc-icon">🛣️</span>
      <span class="sc-body"><span class="sc-type">${type}</span><span class="sc-name">${simplified}</span></span>
      <span class="sc-arrow">›</span>
    </button>`;
  }).join('');
  container.querySelectorAll('.street-choice').forEach(btn=>{
    btn.addEventListener('click',()=>selectStreet(btn.dataset.full));
  });
  showScreen('screen-select');
}

function selectStreet(fullName){
  state.streetFull=fullName;
  const{simplified,type}=parseStreet(fullName);
  state.streetSimple=simplified;state.streetType=type;state.wikiCache={};
  renderHome();
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDU — ACCUEIL
// ═══════════════════════════════════════════════════════════════════════════

function renderHome(){
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

function resetSkeleton(){
  document.getElementById('wiki-content').innerHTML='<div class="sk"></div><div class="sk"></div><div class="sk short"></div>';
  document.getElementById('links-content').innerHTML='<div class="sk"></div><div class="sk short"></div>';
  document.getElementById('nb-content').innerHTML='<div class="sk short"></div>';
  document.getElementById('source-badge').className='source-badge hidden';
  document.getElementById('local-card').classList.add('hidden');
}

async function renderResults(type,sharedName,sharedCity){
  state.resultType=type;
  resetSkeleton();

  const isStreet=(type==='street');
  const name=sharedName||(isStreet?state.streetSimple:state.cityName);
  const city=sharedCity||state.cityName;
  const addr=state.nominatim?.address||{};

  document.getElementById('res-eyebrow').textContent=isStreet?state.streetType:'Ville';
  document.getElementById('res-name').textContent=name;
  document.getElementById('res-city').textContent=[addr.city_district,city].filter(Boolean).join(', ');
  document.getElementById('nb-card').style.display=isStreet?'':'none';

  showScreen('screen-results');

  // Quartier (rue seulement)
  if(isStreet&&state.nominatim){
    const items=[],seen=new Set();
    for(const[k,label]of[
      ['neighbourhood','Quartier'],['suburb','Quartier'],['city_district','Arrondissement'],
      ['city','Ville'],['town','Ville'],['village','Village'],
      ['municipality','Commune'],['county','Département'],['postcode','Code postal'],
    ]){
      if(addr[k]&&!seen.has(label)){seen.add(label);items.push({label,value:addr[k]});}
      if(items.length>=4) break;
    }
    const nbEl=document.getElementById('nb-content');
    if(items.length){
      const grid=items.map(({label,value})=>`<div class="nb-item"><p class="nb-label">${label}</p><p class="nb-value">${value}</p></div>`).join('');
      const{lat,lon}=state.coords||{lat:0,lon:0};
      nbEl.innerHTML=`<div class="nb-grid">${grid}</div><a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}" target="_blank" rel="noopener" class="osm-link">🗺️ Voir sur OpenStreetMap</a>`;
    }else{
      nbEl.innerHTML='<p style="color:var(--muted);font-size:.9rem">Informations non disponibles.</p>';
    }
  }

  // Fetch IA + Wikipedia en parallèle
  const cacheKey=`${type}:${name}`;
  if(!state.wikiCache[cacheKey]){
    state.wikiCache[cacheKey]=isStreet
      ?fetchStreetInfo(name,state.streetFull||name,city,state.coords?.lat,state.coords?.lon)
      :fetchCityInfo(city);
  }

  let res;
  try{res=await state.wikiCache[cacheKey];}catch{res={aiText:null,wiki:null};}
  applyWikiSection(res,name,city);
}

function applyWikiSection(res,name,city){
  const badge=document.getElementById('source-badge');
  const wikiEl=document.getElementById('wiki-content');
  const linksEl=document.getElementById('links-content');

  const streetQuery=state.streetFull?`${state.streetFull} ${city}`:`${name} ${city}`;
  const perplexityUrl=`https://www.perplexity.ai/search?q=${encodeURIComponent('Histoire de la '+streetQuery)}`;
  const mQ=encodeURIComponent(`${state.streetFull||name} ${city}`);
  const gQ=encodeURIComponent(`${name} ${city} histoire`);

  // Liens — toujours affichés
  const wikiUrl=res.wiki?.content_urls?.mobile?.page||res.wiki?.content_urls?.desktop?.page||'';
  linksEl.innerHTML=
    (wikiUrl
      ?linkRow(wikiUrl,`${res.wiki.title} — Wikipédia`,'fr.wikipedia.org','📖')
      :linkRow(`https://fr.wikipedia.org/w/index.php?search=${encodeURIComponent(name)}`,'Chercher sur Wikipédia','fr.wikipedia.org','📖'))+
    linkRow(`https://www.google.com/maps/search/${mQ}`,'Voir sur Google Maps','maps.google.com','📍')+
    linkRow(`https://www.google.com/search?q=${gQ}`,'Rechercher sur Google','google.com','🔍')+
    linkRow(perplexityUrl,'Approfondir avec Perplexity','perplexity.ai','🤖');

  // Contenu principal — synthèse IA
  if(res.aiText){
    badge.className='source-badge ai';
    badge.textContent='🤖 Synthèse générée par IA · peut contenir des imprécisions';
    let html='';
    if(res.wiki?.thumbnail?.source)
      html+=`<img src="${res.wiki.thumbnail.source}" class="wiki-thumb" alt="${name}" loading="lazy">`;
    html+=`<p class="wiki-text">${res.aiText}</p>`;
    wikiEl.innerHTML=html;
  }else{
    // Fallback si Gemini indisponible
    badge.className='source-badge dim';
    badge.textContent='◌ Synthèse IA indisponible — consultez les liens ci-dessous';
    if(res.wiki?.extract){
      const extract=res.wiki.extract.length>520?res.wiki.extract.slice(0,520).replace(/\s+\S*$/,'')+'…':res.wiki.extract;
      let html='';
      if(res.wiki.thumbnail?.source) html+=`<img src="${res.wiki.thumbnail.source}" class="wiki-thumb" alt="${name}" loading="lazy">`;
      html+=`<p class="wiki-origin">Source : <strong>${res.wiki.title}</strong> — Wikipédia</p>`;
      html+=`<p class="wiki-text">${extract}</p>`;
      wikiEl.innerHTML=html;
    }else{
      wikiEl.innerHTML=`<div class="empty"><p class="empty-ico">🔍</p><p>Impossible de générer une synthèse pour <strong>${name}</strong>.<br>Consultez les liens ci-dessous.</p></div>`;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDU — PLAQUES
// ═══════════════════════════════════════════════════════════════════════════

async function loadLeaflet(){
  if(state.leafletLoaded) return;
  await new Promise((res,rej)=>{
    const l=document.createElement('link');l.rel='stylesheet';l.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.appendChild(l);
    const s=document.createElement('script');s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);
  });
  state.leafletLoaded=true;
}

async function renderPlaques(){
  const{lat,lon}=state.coords;
  document.getElementById('pl-subtitle').textContent=`${state.plaques.length} trouvée${state.plaques.length>1?'s':''} · 500 m · ${state.cityName}`;
  showScreen('screen-plaques');

  try{
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
  }catch{
    document.getElementById('map-container').innerHTML='<p style="color:var(--muted);padding:1rem;text-align:center;font-size:.85rem">Carte non disponible</p>';
  }

  const list=document.getElementById('plaques-list');
  if(!state.plaques.length){list.innerHTML='<div class="plaques-empty">🏅<br><br>Aucune plaque recensée dans un rayon de 500 m.</div>';return;}
  list.innerHTML=state.plaques.map((p,i)=>{
    const thumb=p.photo
      ?`<img src="${p.photo}" class="pl-thumb" alt="${p.name}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\"pl-placeholder\\">🏅</div>'">`
      :`<div class="pl-placeholder">🏅</div>`;
    const detail=
      (p.photo?`<img src="${p.photo}" class="pd-photo" alt="${p.name}" loading="lazy">`:'')+
      (p.inscription?`<p class="pd-inscription">"${p.inscription.slice(0,300)}${p.inscription.length>300?'…':''}"</p>`:'')+
      (p.wikiUrl?`<a href="${p.wikiUrl}" target="_blank" rel="noopener" class="pd-wiki">📖 Voir sur Wikipédia</a>`:'');
    return`<div class="plaque-item" data-i="${i}">
      <div class="plaque-summary">${thumb}<div class="pl-info"><p class="pl-name">${p.name}</p><p class="pl-dist">${fmtDist(p.distance)}</p></div><span class="pl-chev">›</span></div>
      <div class="plaque-detail"><div class="pd-inner">${detail||'<p style="color:var(--muted);font-size:.85rem">Aucun détail disponible.</p>'}</div></div>
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

async function locateAndLoad(){
  state.wikiCache={};state.plaques=[];state.manualEdit=false;
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
      try{
        const data=await reverseGeocode(lat,lon);
        state.nominatim=data;
        const road=data.address?.road||data.address?.pedestrian||data.address?.footway||data.address?.path||'';
        if(!road){splashError('Aucune rue identifiée ici. Essayez depuis une rue.');return;}

        splashText('Vérification des rues à proximité…');
        const nearby=await fetchNearbyStreets(lat,lon);
        const all=[...new Set([road,...nearby])].filter(Boolean);

        if(all.length>1){
          showStreetSelection(all);
        }else{
          state.streetFull=road;
          const{simplified,type}=parseStreet(road);
          state.streetSimple=simplified;state.streetType=type;
          renderHome();
        }
      }catch{splashError('Erreur réseau. Vérifiez votre connexion.');}
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
// OUVERTURE PAR URL PARTAGÉE
// ═══════════════════════════════════════════════════════════════════════════

function checkSharedUrl(){
  const p=new URLSearchParams(window.location.search);
  const q=p.get('q'),type=p.get('type')||'street',city=p.get('city')||'';
  if(!q) return false;
  state.streetSimple=q;state.streetFull=q;state.streetType='';state.cityName=city;
  document.getElementById('res-eyebrow').textContent=type==='street'?'Rue':'Ville';
  document.getElementById('res-name').textContent=q;
  document.getElementById('res-city').textContent=city;
  document.getElementById('nb-card').style.display='none';
  resetSkeleton();
  state.resultType=type;
  showScreen('screen-results');
  const cacheKey=`${type}:${q}`;
  state.wikiCache[cacheKey]=type==='street'
    ?fetchStreetInfo(q,q,city,null,null)
    :fetchCityInfo(city);
  state.wikiCache[cacheKey].then(res=>applyWikiSection(res,q,city)).catch(()=>{});
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// ÉVÉNEMENTS
// ═══════════════════════════════════════════════════════════════════════════

document.getElementById('btn-retry').addEventListener('click',locateAndLoad);
document.getElementById('btn-relocate').addEventListener('click',locateAndLoad);
document.getElementById('btn-back-select').addEventListener('click',locateAndLoad);
document.getElementById('btn-street').addEventListener('click',()=>renderResults('street'));
document.getElementById('btn-city').addEventListener('click',()=>renderResults('city'));
document.getElementById('btn-plaques').addEventListener('click',renderPlaques);
document.getElementById('btn-about').addEventListener('click',()=>showScreen('screen-about'));
document.getElementById('btn-back-results').addEventListener('click',()=>showScreen('screen-home'));
document.getElementById('btn-back-plaques').addEventListener('click',()=>showScreen('screen-home'));
document.getElementById('btn-back-about').addEventListener('click',()=>showScreen('screen-home'));
document.getElementById('btn-share').addEventListener('click',doShare);

document.getElementById('btn-edit').addEventListener('click',()=>{
  const f=document.getElementById('edit-form');
  const open=f.classList.toggle('open');
  if(open){const i=document.getElementById('edit-input');i.value=state.streetSimple;i.focus();i.select();}
});
document.getElementById('btn-edit-cancel').addEventListener('click',()=>document.getElementById('edit-form').classList.remove('open'));
document.getElementById('edit-input').addEventListener('keydown',e=>{if(e.key==='Enter')applyEdit();if(e.key==='Escape')document.getElementById('edit-form').classList.remove('open');});
document.getElementById('btn-edit-ok').addEventListener('click',applyEdit);

function applyEdit(){
  const raw=document.getElementById('edit-input').value.trim();
  if(!raw) return;
  const{simplified,type}=parseStreet(raw);
  state.streetSimple=simplified;state.streetType=type;state.streetFull=raw;
  state.manualEdit=true;state.wikiCache={};
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
