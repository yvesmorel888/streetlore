'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// LOCALE — Configuration régionale
// Modifier ces valeurs pour adapter l'app à une autre langue / un autre pays.
// Les chaînes dans index.html feront l'objet d'une passe i18n séparée.
// ═══════════════════════════════════════════════════════════════════════════

const LOCALE = {
  lang:         'fr',       // Code langue ISO 639-1 (Wikipedia, Nominatim, Wikidata)
  country:      'FR',       // Code pays ISO 3166-1 alpha-2
  wikipedia:    'fr',       // Sous-domaine Wikipedia  (fr → fr.wikipedia.org)
  wikiSitelink: 'frwiki',   // Clé sitelink Wikidata pour l'édition Wikipedia nationale
  features: {
    monuments: true,         // API Mérimée — France uniquement (data.culture.gouv.fr)
  },
};

// Chaînes UI gérées côté JS (messages dynamiques, liens construits par code)
const UI = {
  splash: {
    locating:   'Localisation en cours…',
    street:     'Identification de la rue…',
    nearby:     'Vérification des rues à proximité…',
    noRoad:     'Aucune rue identifiée ici. Essayez depuis une rue.',
    errNet:     'Erreur réseau. Vérifiez votre connexion.',
    noGeo:      'Géolocalisation non supportée.',
    gpsRefused: 'Position refusée. Autorisez la géolocalisation dans les réglages.',
    gpsTimeout: 'Délai GPS dépassé. Réessayez à l\'extérieur.',
    gpsError:   'Position indisponible. Réessayez.',
  },
  source: {
    wikipedia: '📖 Source : Wikipédia',
    noWiki:    '◌ Aucune information Wikipedia trouvée',
    oldName:   '📜 Anciennement :',
  },
  search: {
    perplexityPrefix: 'Histoire de la',  // préfixe requête Perplexity
    googleSuffix:     'histoire',         // suffixe requête Google
  },
  links: {
    wikipedia:  title => `${title} — Wikipédia`,
    searchWiki: 'Chercher sur Wikipédia',
    maps:       'Voir sur Google Maps',
    google:     'Rechercher sur Google',
    perplexity: 'Approfondir avec Perplexity',
    osm:        '🗺️ Voir sur OpenStreetMap',
    merimee:    'Fiche Mérimée (Ministère de la Culture)',
  },
  share: {
    copied:  '📋 Lien copié dans le presse-papier',
    editOk:  name => `✏️ Nom modifié : ${name}`,
    text:    (name, city) => `${name}${city ? ' (' + city + ')' : ''} — découvert avec StreetLore`,
  },
  map:   { youAreHere: 'Vous êtes ici' },
  empty: {
    noInfo:   name => `Aucune information disponible pour <strong>${name}</strong>.<br>Utilisez les liens ci-dessous pour en savoir plus.`,
    noPlaque: 'Aucune plaque recensée dans un rayon de 500 m.',
    noMH:     'Aucun monument historique recensé dans un rayon de 500 m.',
    noData:   'Informations non disponibles.',
  },
};

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
  comcomName:    '',
  deptName:      '',
  regionName:    '',
  plaques:       [],
  monuments:     [],
  resultType:    '',
  wikiCache:     {},
  manualEdit:    false,
  manualCity:    '',
  manualCoords:  null,
  leafletLoaded: false,
  mapInstance:   null,
  mhMapInstance: null,
  nearbyStreets: [],
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
// API — NOMINATIM
// ═══════════════════════════════════════════════════════════════════════════

async function reverseGeocode(lat,lon){
  const u=new URL('https://nominatim.openstreetmap.org/reverse');
  u.searchParams.set('format','json');u.searchParams.set('lat',lat);
  u.searchParams.set('lon',lon);u.searchParams.set('zoom','18');
  u.searchParams.set('addressdetails','1');u.searchParams.set('accept-language',LOCALE.lang);
  const r=await withTimeout(fetch(u,{headers:{'User-Agent':'StreetLore/2.7'}}),10000);
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

async function geocodeCity(cityName){
  try{
    const u=new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('q',cityName);u.searchParams.set('format','json');
    u.searchParams.set('addressdetails','1');u.searchParams.set('limit','5');
    u.searchParams.set('accept-language',LOCALE.lang);
    u.searchParams.set('countrycodes',LOCALE.country.toLowerCase());
    const r=await withTimeout(fetch(u,{headers:{'User-Agent':'StreetLore/3.2'}}),8000);
    if(!r.ok) return [];
    return await r.json();
  }catch{return [];}
}

async function fetchComcom(lat,lon){
  try{
    const u=new URL('https://geo.api.gouv.fr/communes');
    u.searchParams.set('lat',lat);u.searchParams.set('lon',lon);
    u.searchParams.set('fields','nom,epci');
    const r=await withTimeout(fetch(u),8000);
    if(!r.ok) return null;
    const data=await r.json();
    return data[0]?.epci?.nom||null;
  }catch{return null;}
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
    // Récupération du ou des anciens noms
    const oldParts=[t['old_name'],t[`old_name:${LOCALE.lang}`]].filter(Boolean);
    const oldName=oldParts.length?oldParts.join(' · '):null;
    return{
      wikidata:  t['name:etymology:wikidata']||null,
      wikipedia: t['wikipedia']||t['name:etymology:wikipedia']||null,
      oldName,
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
// API — MONUMENTS HISTORIQUES (500 m)
// ═══════════════════════════════════════════════════════════════════════════

function parseMHRecord(rec,refLat,refLon){
  const coords=rec.coordonnees_gps;
  const lat2=coords?.lat??coords?.latitude;
  const lon2=coords?.lon??coords?.longitude;
  if(!lat2||!lon2) return null;
  const ref=rec.reference_de_la_notice_merimee||'';
  const rawType=(rec.type_de_protection||rec.type_protection||'').toLowerCase();
  const type=rawType.includes('class')?'classé MH':rawType.includes('inscrit')?'inscrit MH':'MH';
  const year=(rec.date_de_protection||'').slice(0,4)||'';
  const merimeeUrl=ref?`https://www.pop.culture.gouv.fr/notice/merimee/${ref}`:'';
  return{
    id:ref||`mh-${lat2}-${lon2}`,
    name:rec.appellation_courante||'Monument historique',
    type,adresse:rec.adresse_de_localisation||rec.adresse||'',year,merimeeUrl,
    lat:lat2,lon:lon2,
    distance:(refLat&&refLon)?haversine(refLat,refLon,lat2,lon2):null,
  };
}

// GPS mode : 500 m autour de la position
async function fetchMonumentsHistoriques(lat,lon){
  try{
    const url=new URL('https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets/liste-des-immeubles-proteges-au-titre-des-monuments-historiques/records');
    url.searchParams.set('where',`dist(coordonnees_gps, geom'POINT(${lon} ${lat})', 500m)`);
    url.searchParams.set('limit','30');
    url.searchParams.set('order_by',`dist(coordonnees_gps, geom'POINT(${lon} ${lat})')`);
    const r=await withTimeout(fetch(url,{headers:{Accept:'application/json'}}),10000);
    if(!r.ok) return[];
    return(await r.json()).results?.map(rec=>parseMHRecord(rec,lat,lon)).filter(Boolean)??[];
  }catch{return[];}
}

// Mode manuel : tous les monuments de la commune (par nom), triés par distance au centre
async function fetchMonumentsCommune(cityName,refLat,refLon){
  try{
    const url=new URL('https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets/liste-des-immeubles-proteges-au-titre-des-monuments-historiques/records');
    url.searchParams.set('where',`commune="${cityName.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/'/g,' ')}"`);
    url.searchParams.set('limit','100');
    const r=await withTimeout(fetch(url,{headers:{Accept:'application/json'}}),10000);
    if(!r.ok) return[];
    const list=(await r.json()).results?.map(rec=>parseMHRecord(rec,refLat,refLon)).filter(Boolean)??[];
    return list.sort((a,b)=>(a.distance??0)-(b.distance??0));
  }catch{return[];}
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
  OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) = "${LOCALE.lang}") }
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://${LOCALE.wikipedia}.wikipedia.org/> . }
} LIMIT 40`;
    const url=`https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
    const r=await withTimeout(fetch(url,{headers:{'Accept':'application/sparql-results+json','User-Agent':'StreetLore/2.7'}}),14000);
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
    return(await r.json()).entities?.[qid]?.sitelinks?.[LOCALE.wikiSitelink]?.title||null;
  }catch{return null;}
}

async function wikiSummary(title){
  try{
    const r=await withTimeout(fetch(`https://${LOCALE.wikipedia}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`),7000);
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
      if(lang===LOCALE.lang){const w=await wikiSummary(rest.join(':'));if(w?.extract) return w;}
    }
  }
  // 2. Page dédiée à la rue
  if(city){const w=await wikiSummary(`${full} (${city})`);if(w?.extract&&w.type!=='disambiguation') return w;}
  // 2.5 Nom simplifié en direct — "Georges Clémenceau" → page de la personne sans passer par la recherche
  if(simple!==full){
    const w25=await wikiSummary(simple);
    if(w25?.extract&&w25.type!=='disambiguation'){
      const q25=(w25.title?.match(/\(([^)]+)\)$/)?.[1]||'').toLowerCase();
      const cl=(city||'').toLowerCase();
      if(!q25||!cl||q25.includes(cl)||cl.includes(q25)) return w25;
    }
  }
  const w2=await wikiSummary(full);
  if(w2?.extract&&w2.type!=='disambiguation'){
    // Rejeter si Wikipedia renvoie une page qualifiée pour une autre ville — ex. "Rue X (Liège)" alors qu'on est à Ancenis
    const qualifier=(w2.title?.match(/\(([^)]+)\)$/)?.[1]||'').toLowerCase();
    const cityLow=(city||'').toLowerCase();
    if(!qualifier||!cityLow||qualifier.includes(cityLow)||cityLow.includes(qualifier)) return w2;
  }
  // 3. Recherche par nom simplifié
  try{
    const u=new URL(`https://${LOCALE.wikipedia}.wikipedia.org/w/api.php`);
    u.searchParams.set('action','query');u.searchParams.set('list','search');
    u.searchParams.set('srsearch',simple);u.searchParams.set('format','json');
    u.searchParams.set('origin','*');u.searchParams.set('srlimit','5');
    const r=await withTimeout(fetch(u),6000);
    if(!r.ok) return null;
    const results=(await r.json()).query?.search??[];
    const norm=s=>s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    const simpleNorm=norm(simple);
    for(const res of results){
      // Pertinence : le titre de l'article doit contenir le terme recherché (sans accents)
      if(!norm(res.title).includes(simpleNorm)) continue;
      const s=await wikiSummary(res.title);
      if(s&&s.type!=='disambiguation') return s;
    }
  }catch{}
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// RECHERCHE PRINCIPALE — Wikipedia
// ═══════════════════════════════════════════════════════════════════════════

async function fetchOldName(full,lat,lon){
  if(!lat||!lon) return null;
  try{
    const etym=await getEtymology(full,lat,lon);
    return etym?.oldName||null;
  }catch{return null;}
}

async function fetchStreetInfo(simple,full,city,lat,lon){
  const[wikiRes,oldNameRes]=await Promise.allSettled([
    findBestWikiArticle(simple,full,city,lat,lon),
    fetchOldName(full,lat,lon),
  ]);
  return{
    wiki:    wikiRes.status==='fulfilled'?wikiRes.value:null,
    oldName: oldNameRes.status==='fulfilled'?oldNameRes.value:null,
  };
}

async function fetchCityInfo(name){
  let wiki=await wikiSummary(name).catch(()=>null);
  if(!wiki?.extract){
    try{
      const u=new URL(`https://${LOCALE.wikipedia}.wikipedia.org/w/api.php`);
      u.searchParams.set('action','query');u.searchParams.set('list','search');
      u.searchParams.set('srsearch',name);u.searchParams.set('format','json');
      u.searchParams.set('origin','*');u.searchParams.set('srlimit','3');
      const r=await withTimeout(fetch(u),6000);
      if(r.ok){
        const results=(await r.json()).query?.search??[];
        for(const res of results){
          const s=await wikiSummary(res.title);
          if(s?.extract&&s.type!=='disambiguation'){wiki=s;break;}
        }
      }
    }catch{}
  }
  return{wiki};
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
    else{await navigator.clipboard.writeText(url);toast(UI.share.copied);}
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

function updateOsmLink(){
  const c=state.manualEdit&&state.manualCoords?state.manualCoords:state.coords;
  if(!c) return;
  const link=document.getElementById('osm-link');
  if(link) link.href=`https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=17/${c.lat}/${c.lon}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDU — ACCUEIL
// ═══════════════════════════════════════════════════════════════════════════

function renderHome(){
  const addr=state.nominatim.address;
  const city=state.manualCity||(addr.city||addr.town||addr.village||addr.municipality||'');
  state.cityName=city;
  const dept=addr.county||'';
  const region=addr.state||'';
  state.comcomName='';state.deptName=dept;state.regionName=region;
  document.getElementById('home-type').textContent=state.streetType;
  document.getElementById('home-name').textContent=state.streetSimple||'—';
  document.getElementById('home-city').textContent=city?`📍 ${[addr.city_district,city].filter(Boolean).join(' · ')}`:'';
  document.getElementById('sub-street').textContent=state.streetSimple;
  document.getElementById('sub-city').textContent=city;
  document.getElementById('sub-comcom').textContent='';
  document.getElementById('sub-dept').textContent=dept;
  document.getElementById('sub-region').textContent=region;
  document.getElementById('manual-notice').classList.add('hidden');
  document.getElementById('plaques-badge').classList.add('hidden');
  document.getElementById('plaques-loading').classList.remove('hidden');
  document.getElementById('mh-badge').classList.add('hidden');
  document.getElementById('mh-loading').classList.remove('hidden');
  const btnChange=document.getElementById('btn-change-street');
  if(state.nearbyStreets.length>1) btnChange.classList.remove('hidden');
  else btnChange.classList.add('hidden');
  showScreen('screen-home');

  // Pas de rue identifiée : ouvrir le formulaire d'édition automatiquement
  if(!state.streetSimple){
    document.getElementById('manual-notice').classList.remove('hidden');
    setTimeout(()=>{
      document.getElementById('edit-form').classList.add('open');
      document.getElementById('edit-input').focus();
    },250);
  }

  updateOsmLink();

  const{lat,lon}=state.coords;

  // Communauté de communes via geo.api.gouv.fr
  fetchComcom(lat,lon).then(cc=>{
    if(cc){state.comcomName=cc;document.getElementById('sub-comcom').textContent=cc;}
  }).catch(()=>{});

  fetchAllPlaques(lat,lon).then(pl=>{
    state.plaques=pl;
    document.getElementById('plaques-loading').classList.add('hidden');
    if(pl.length){
      document.getElementById('pb-label').textContent=`${pl.length} plaque${pl.length>1?'s':''} commémorative${pl.length>1?'s':''}`;
      document.getElementById('plaques-badge').classList.remove('hidden');
    }
  }).catch(()=>document.getElementById('plaques-loading').classList.add('hidden'));

  if(LOCALE.features.monuments){
    fetchMonumentsHistoriques(lat,lon).then(mh=>{
      state.monuments=mh;
      document.getElementById('mh-loading').classList.add('hidden');
      if(mh.length){
        document.getElementById('mh-label').textContent=`${mh.length} monument${mh.length>1?'s':''} historique${mh.length>1?'s':''}`;
        document.getElementById('mh-badge').classList.remove('hidden');
      }
    }).catch(()=>document.getElementById('mh-loading').classList.add('hidden'));
  }else{
    document.getElementById('mh-loading').classList.add('hidden');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDU — RÉSULTATS
// ═══════════════════════════════════════════════════════════════════════════

function resetSkeleton(){
  document.getElementById('wiki-content').innerHTML='<div class="sk"></div><div class="sk"></div><div class="sk short"></div>';
  document.getElementById('links-content').innerHTML='<div class="sk"></div><div class="sk short"></div>';
  document.getElementById('source-badge').className='source-badge hidden';
  document.getElementById('local-card').classList.add('hidden');
}

async function renderResults(type,sharedName,sharedCity){
  state.resultType=type;
  resetSkeleton();

  const isStreet=(type==='street');
  const nameMap={street:state.streetSimple,city:state.cityName,comcom:state.comcomName,dept:state.deptName,region:state.regionName};
  const eyebrowMap={street:state.streetType,city:'Ville',comcom:'Intercommunalité',dept:'Département',region:'Région'};
  const name=sharedName||nameMap[type]||'';
  const city=sharedCity||state.cityName;
  const addr=state.nominatim?.address||{};

  document.getElementById('res-eyebrow').textContent=eyebrowMap[type]||'';
  document.getElementById('res-name').textContent=name||eyebrowMap[type]||'';
  document.getElementById('res-city').textContent=[addr.city_district,city].filter(Boolean).join(', ');

  showScreen('screen-results');


  // Fetch IA + Wikipedia en parallèle
  const cacheKey=`${type}:${name}`;
  if(!state.wikiCache[cacheKey]){
    state.wikiCache[cacheKey]=isStreet
      ?fetchStreetInfo(name,state.streetFull||name,city,state.coords?.lat,state.coords?.lon)
      :fetchCityInfo(name);
  }

  let res;
  try{res=await state.wikiCache[cacheKey];}catch{res={wiki:null};}
  applyWikiSection(res,name,city);
}

function applyWikiSection(res,name,city){
  const badge=document.getElementById('source-badge');
  const wikiEl=document.getElementById('wiki-content');
  const linksEl=document.getElementById('links-content');

  const isStreetResult=(state.resultType==='street');
  let perplexityQ;
  if(isStreetResult){
    const simpleCap=(state.streetSimple||name).charAt(0).toUpperCase()+(state.streetSimple||name).slice(1);
    const isArticle=/^(le|la|les|l'|du|de|des)$/i.test(state.streetType||'');
    const typeStr=isArticle?'rue':state.streetType||'rue';
    perplexityQ=`${typeStr.charAt(0).toUpperCase()+typeStr.slice(1)} ${simpleCap} ${city} histoire`;
  }else{
    perplexityQ=`Histoire de ${name}`;
  }
  const perplexityUrl=`https://www.perplexity.ai/search?q=${encodeURIComponent(perplexityQ)}`;
  const mQ=encodeURIComponent(isStreetResult?`${state.streetFull||name} ${city}`:name);
  const gQ=encodeURIComponent(`${name} ${UI.search.googleSuffix}`);
  const wikiDomain=`${LOCALE.wikipedia}.wikipedia.org`;

  // Liens — toujours affichés
  const wikiUrl=res.wiki?.content_urls?.mobile?.page||res.wiki?.content_urls?.desktop?.page||'';
  linksEl.innerHTML=
    (wikiUrl
      ?linkRow(wikiUrl,UI.links.wikipedia(res.wiki.title),wikiDomain,'📖')
      :linkRow(`https://${wikiDomain}/w/index.php?search=${encodeURIComponent(name)}`,UI.links.searchWiki,wikiDomain,'📖'))+
    linkRow(`https://www.google.com/maps/search/${mQ}`,UI.links.maps,'maps.google.com','📍')+
    linkRow(`https://www.google.com/search?q=${gQ}`,UI.links.google,'google.com','🔍')+
    linkRow(perplexityUrl,UI.links.perplexity,'perplexity.ai','🤖');

  // Contenu principal — Wikipedia
  if(res.wiki?.extract){
    const extract=res.wiki.extract.length>600?res.wiki.extract.slice(0,600).replace(/\s+\S*$/,'')+'…':res.wiki.extract;
    badge.className='source-badge info';
    badge.textContent=UI.source.wikipedia;
    let html='';
    if(res.wiki.thumbnail?.source) html+=`<img src="${res.wiki.thumbnail.source}" class="wiki-thumb" alt="${name}" loading="lazy">`;
    html+=`<p class="wiki-text">${extract}</p>`;
    if(res.oldName) html+=`<p class="old-name">${UI.source.oldName} <strong>${res.oldName}</strong></p>`;
    wikiEl.innerHTML=html;
  }else{
    badge.className='source-badge dim';
    badge.textContent=UI.source.noWiki;
    const oldNameHtml=res.oldName?`<p class="old-name" style="margin-top:1rem">${UI.source.oldName} <strong>${res.oldName}</strong></p>`:'';
    wikiEl.innerHTML=`<div class="empty"><p class="empty-ico">🔍</p><p>${UI.empty.noInfo(name)}</p></div>${oldNameHtml}`;
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
    L.marker([lat,lon],{icon:uIco}).addTo(map).bindPopup(`<strong>${UI.map.youAreHere}</strong>`);
    const pIco=L.divIcon({className:'',html:'<div style="width:12px;height:12px;background:#3b82f6;border:2px solid #fff;border-radius:50%;"></div>',iconAnchor:[6,6]});
    for(const p of state.plaques) L.marker([p.lat,p.lon],{icon:pIco}).addTo(map).bindPopup(`<strong>${p.name}</strong><br><small>${fmtDist(p.distance)}</small>`);
    state.mapInstance=map;
  }catch{
    document.getElementById('map-container').innerHTML='<p style="color:var(--muted);padding:1rem;text-align:center;font-size:.85rem">Carte non disponible</p>';
  }

  const list=document.getElementById('plaques-list');
  if(!state.plaques.length){list.innerHTML=`<div class="plaques-empty">🏅<br><br>${UI.empty.noPlaque}</div>`;return;}
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
// RENDU — MONUMENTS HISTORIQUES
// ═══════════════════════════════════════════════════════════════════════════

async function renderMonuments(){
  const{lat,lon}=state.manualCoords||state.coords;
  document.getElementById('mh-subtitle').textContent=state.manualEdit
    ?`${state.monuments.length} trouvé${state.monuments.length>1?'s':''} · ${state.cityName}`
    :`${state.monuments.length} trouvé${state.monuments.length>1?'s':''} · 500 m · ${state.cityName}`;
  showScreen('screen-monuments');

  try{
    await loadLeaflet();
    const mapEl=document.getElementById('mh-map-container');
    if(state.mhMapInstance){state.mhMapInstance.remove();state.mhMapInstance=null;}
    const map=L.map(mapEl,{zoomControl:false}).setView([lat,lon],16);
    L.control.zoom({position:'bottomright'}).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:19}).addTo(map);
    const uIco=L.divIcon({className:'',html:'<div style="width:14px;height:14px;background:#f59e0b;border:3px solid #fff;border-radius:50%;box-shadow:0 0 8px rgba(245,158,11,.6)"></div>',iconAnchor:[7,7]});
    L.marker([lat,lon],{icon:uIco}).addTo(map).bindPopup(`<strong>${UI.map.youAreHere}</strong>`);
    const mIco=L.divIcon({className:'',html:'<div style="width:13px;height:13px;background:#10b981;border:2px solid #fff;border-radius:3px;"></div>',iconAnchor:[6,6]});
    for(const m of state.monuments)
      L.marker([m.lat,m.lon],{icon:mIco}).addTo(map)
        .bindPopup(`<strong>${m.name}</strong><br><small>${m.type} · ${fmtDist(m.distance)}</small>`);
    state.mhMapInstance=map;
  }catch{
    document.getElementById('mh-map-container').innerHTML='<p style="color:var(--muted);padding:1rem;text-align:center;font-size:.85rem">Carte non disponible</p>';
  }

  const list=document.getElementById('mh-list');
  if(!state.monuments.length){
    list.innerHTML=`<div class="plaques-empty">🏛️<br><br>${UI.empty.noMH}</div>`;
    return;
  }
  list.innerHTML=state.monuments.map((m,i)=>{
    const typeClass=m.type.includes('classé')?'classe':'inscrit';
    return`<div class="mh-item" data-i="${i}">
      <div class="mh-summary">
        <div class="mh-icon">🏛️</div>
        <div class="mh-body">
          <p class="mh-name">${m.name}</p>
          <div class="mh-badges">
            <span class="mh-type ${typeClass}">${m.type}</span>
            ${m.year?`<span class="mh-year">depuis ${m.year}</span>`:''}
          </div>
          ${m.adresse?`<p class="mh-adresse">${m.adresse}</p>`:''}
          ${m.distance!==null?`<p class="mh-dist">${fmtDist(m.distance)}</p>`:''}
        </div>
        <span class="mh-chev">›</span>
      </div>
      <div class="mh-detail">
        <div class="mh-wiki"></div>
        ${m.merimeeUrl?`<a href="${m.merimeeUrl}" target="_blank" rel="noopener" class="mh-link">📋 ${UI.links.merimee}</a>`:''}
        <a href="https://www.google.com/search?q=${encodeURIComponent(m.name+' '+state.cityName+' '+UI.search.googleSuffix)}" target="_blank" rel="noopener" class="mh-link">🔍 ${UI.links.google}</a>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.mh-summary').forEach(el=>{
    el.addEventListener('click',()=>{
      const item=el.closest('.mh-item');
      const was=item.classList.contains('open');
      list.querySelectorAll('.mh-item').forEach(i=>i.classList.remove('open'));
      if(!was){
        item.classList.add('open');
        const m=state.monuments[+item.dataset.i];
        if(state.mhMapInstance) state.mhMapInstance.flyTo([m.lat,m.lon],17,{duration:.8});
        // Wikipedia lazy-load
        const wikiEl=item.querySelector('.mh-wiki');
        if(wikiEl&&!wikiEl.dataset.loaded){
          wikiEl.dataset.loaded='1';
          wikiEl.innerHTML='<div class="sk short"></div>';
          fetchCityInfo(m.name).then(({wiki})=>{
            if(!wiki?.extract){wikiEl.innerHTML='';return;}
            const img=wiki.thumbnail?.source?`<img class="mh-wiki-img" src="${wiki.thumbnail.source}" alt="" loading="lazy">`:'';
            const text=wiki.extract.length>280?wiki.extract.slice(0,280).replace(/\s+\S*$/,'')+'…':wiki.extract;
            const link=wiki.content_urls?.mobile?.page||wiki.content_urls?.desktop?.page||'';
            wikiEl.innerHTML=img+`<p class="mh-wiki-text">${text}</p>`+(link?`<a href="${link}" target="_blank" rel="noopener" class="mh-link">📖 Wikipedia</a>`:'');
          }).catch(()=>{wikiEl.innerHTML='';});
        }
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GPS + FLUX PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

function splashText(t){document.getElementById('splash-text').textContent=t;}
function splashError(msg){document.getElementById('splash-spinner').style.display='none';splashText(msg);document.getElementById('btn-retry').classList.remove('hidden');}

async function locateAndLoad(){
  state.wikiCache={};state.plaques=[];state.manualEdit=false;state.manualCity='';state.manualCoords=null;
  showScreen('screen-splash');
  document.getElementById('btn-retry').classList.add('hidden');
  document.getElementById('splash-spinner').style.display='';
  splashText(UI.splash.locating);

  if(!navigator.geolocation){splashError(UI.splash.noGeo);return;}

  navigator.geolocation.getCurrentPosition(
    async pos=>{
      const{latitude:lat,longitude:lon}=pos.coords;
      state.coords={lat,lon};
      splashText(UI.splash.street);
      try{
        const data=await reverseGeocode(lat,lon);
        state.nominatim=data;
        const road=data.address?.road||data.address?.pedestrian||data.address?.footway||data.address?.path||'';
        if(!road){
          // Ville connue mais aucune rue — passer en mode test directement
          state.streetFull='';state.streetSimple='';state.streetType='';
          state.manualEdit=true;
          renderHome();
          return;
        }

        splashText(UI.splash.nearby);
        const nearby=await fetchNearbyStreets(lat,lon);
        const all=[...new Set([road,...nearby])].filter(Boolean).slice(0,5);
        state.nearbyStreets=all;

        if(all.length>1){
          showStreetSelection(all);
        }else{
          state.streetFull=road;
          const{simplified,type}=parseStreet(road);
          state.streetSimple=simplified;state.streetType=type;
          renderHome();
        }
      }catch{splashError(UI.splash.errNet);}
    },
    err=>{
      if(err.code===1) splashError(UI.splash.gpsRefused);
      else if(err.code===3) splashError(UI.splash.gpsTimeout);
      else splashError(UI.splash.gpsError);
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
document.getElementById('btn-back-select').addEventListener('click',()=>{
  if(state.nominatim) showScreen('screen-home'); else locateAndLoad();
});
document.getElementById('btn-change-street').addEventListener('click',()=>showStreetSelection(state.nearbyStreets));
document.getElementById('btn-street').addEventListener('click',()=>{
  if(!state.streetSimple){
    document.getElementById('edit-form').classList.add('open');
    document.getElementById('edit-input').focus();
    return;
  }
  renderResults('street');
});
document.getElementById('btn-city').addEventListener('click',()=>renderResults('city'));
document.getElementById('btn-comcom').addEventListener('click',()=>renderResults('comcom'));
document.getElementById('btn-dept').addEventListener('click',()=>renderResults('dept'));
document.getElementById('btn-region').addEventListener('click',()=>renderResults('region'));
document.getElementById('btn-plaques').addEventListener('click',renderPlaques);
document.getElementById('btn-monuments').addEventListener('click',renderMonuments);
document.getElementById('btn-about').addEventListener('click',()=>showScreen('screen-about'));
document.getElementById('btn-back-results').addEventListener('click',()=>showScreen('screen-home'));
document.getElementById('btn-back-plaques').addEventListener('click',()=>showScreen('screen-home'));
document.getElementById('btn-back-monuments').addEventListener('click',()=>showScreen('screen-home'));
document.getElementById('btn-back-about').addEventListener('click',()=>showScreen('screen-home'));
document.getElementById('btn-share').addEventListener('click',doShare);

document.getElementById('btn-edit').addEventListener('click',()=>{
  const f=document.getElementById('edit-form');
  const open=f.classList.toggle('open');
  if(open){const i=document.getElementById('edit-input');i.value=state.streetSimple;i.focus();i.select();}
});
document.getElementById('btn-edit-cancel').addEventListener('click',()=>document.getElementById('edit-form').classList.remove('open'));
document.getElementById('edit-input').addEventListener('keydown',e=>{if(e.key==='Enter')applyEdit();if(e.key==='Escape')document.getElementById('edit-form').classList.remove('open');});
document.getElementById('edit-city-input').addEventListener('keydown',e=>{if(e.key==='Enter')applyEdit();if(e.key==='Escape')document.getElementById('edit-form').classList.remove('open');});
document.getElementById('btn-edit-ok').addEventListener('click',applyEdit);

function applyEdit(){
  const raw=document.getElementById('edit-input').value.trim();
  const cityRaw=document.getElementById('edit-city-input').value.trim();
  if(!raw&&!cityRaw) return;
  const{simplified,type}=raw?parseStreet(raw):{simplified:'',type:''};
  if(!cityRaw){_applyEdit(raw,simplified,type,'',null);return;}
  const sugDiv=document.getElementById('city-suggestions');
  sugDiv.innerHTML='<span class="city-sug-loading">Recherche…</span>';
  sugDiv.classList.remove('hidden');
  geocodeCity(cityRaw).then(results=>{
    if(!results||results.length===0){
      sugDiv.innerHTML='<span class="city-sug-none">Ville introuvable — nom conservé</span>';
      setTimeout(()=>{sugDiv.classList.add('hidden');sugDiv.innerHTML='';},2000);
      _applyEdit(raw,simplified,type,cityRaw,null);
    }else if(results.length===1){
      sugDiv.classList.add('hidden');sugDiv.innerHTML='';
      const r=results[0];
      const city=r.address?.town||r.address?.village||r.address?.city||r.address?.municipality||r.display_name.split(',')[0].trim();
      _applyEdit(raw,simplified,type,city,r);
    }else{
      sugDiv.innerHTML='<p class="city-sug-label">Plusieurs résultats — choisissez :</p>';
      results.forEach(r=>{
        const city=r.address?.town||r.address?.village||r.address?.city||r.address?.municipality||r.display_name.split(',')[0].trim();
        const dept=r.address?.county||r.address?.state_district||'';
        const btn=document.createElement('button');
        btn.className='city-sug-item';
        btn.textContent=dept?`${city} (${dept})`:city;
        btn.addEventListener('click',()=>{sugDiv.classList.add('hidden');sugDiv.innerHTML='';_applyEdit(raw,simplified,type,city,r);});
        sugDiv.appendChild(btn);
      });
    }
  }).catch(()=>{sugDiv.classList.add('hidden');sugDiv.innerHTML='';_applyEdit(raw,simplified,type,cityRaw,null);});
}

function _applyEdit(raw,simplified,type,cityName,geoResult){
  if(raw){
    state.streetSimple=simplified;state.streetType=type;state.streetFull=raw;
    document.getElementById('home-type').textContent=type;
    document.getElementById('home-name').textContent=simplified;
    document.getElementById('sub-street').textContent=simplified;
  }
  state.manualEdit=true;state.manualCity=cityName;state.wikiCache={};
  if(cityName) state.cityName=cityName;
  document.getElementById('home-city').textContent=cityName?`📍 ${cityName}`:(state.nominatim?document.getElementById('home-city').textContent:'');
  document.getElementById('sub-city').textContent=cityName||state.cityName;
  document.getElementById('edit-form').classList.remove('open');
  const noticeEl=document.getElementById('manual-notice');
  noticeEl.classList.remove('hidden');
  noticeEl.textContent=geoResult?'✏️ Mode manuel':'✏️ Mode test';
  toast(raw?UI.share.editOk(simplified):cityName?`✏️ Ville : ${cityName}`:'✏️ Mode test activé');
  if(!geoResult) return;
  const addr=geoResult.address||{};
  const dept=addr.county||'';const region=addr.state||'';
  state.deptName=dept;state.regionName=region;
  document.getElementById('sub-dept').textContent=dept;
  document.getElementById('sub-region').textContent=region;
  state.comcomName='';document.getElementById('sub-comcom').textContent='';
  const lat=parseFloat(geoResult.lat);const lon=parseFloat(geoResult.lon);
  if(!isNaN(lat)&&!isNaN(lon)){
    state.manualCoords={lat,lon};
    updateOsmLink();
    fetchComcom(lat,lon).then(cc=>{
      if(cc){state.comcomName=cc;document.getElementById('sub-comcom').textContent=cc;}
    }).catch(()=>{});
    // Plaques et monuments pour la ville géocodée
    state.plaques=[];state.monuments=[];
    document.getElementById('plaques-badge').classList.add('hidden');
    document.getElementById('plaques-loading').classList.remove('hidden');
    fetchAllPlaques(lat,lon).then(pl=>{
      state.plaques=pl;
      document.getElementById('plaques-loading').classList.add('hidden');
      if(pl.length){
        document.getElementById('pb-label').textContent=`${pl.length} plaque${pl.length>1?'s':''} commémorative${pl.length>1?'s':''}`;
        document.getElementById('plaques-badge').classList.remove('hidden');
      }
    }).catch(()=>document.getElementById('plaques-loading').classList.add('hidden'));
    if(LOCALE.features.monuments){
      document.getElementById('mh-badge').classList.add('hidden');
      document.getElementById('mh-loading').classList.remove('hidden');
      fetchMonumentsCommune(cityName,lat,lon).then(mh=>{
        state.monuments=mh;
        document.getElementById('mh-loading').classList.add('hidden');
        if(mh.length){
          document.getElementById('mh-label').textContent=`${mh.length} monument${mh.length>1?'s':''} historique${mh.length>1?'s':''}`;
          document.getElementById('mh-badge').classList.remove('hidden');
        }
      }).catch(()=>document.getElementById('mh-loading').classList.add('hidden'));
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE WORKER
// ═══════════════════════════════════════════════════════════════════════════

if('serviceWorker'in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════

if(!checkSharedUrl()) locateAndLoad();
