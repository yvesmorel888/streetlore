'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════════

const PLAQUE_RADIUS_M  = 500;
const GPS_TIMEOUT_MS   = 13000;
const WIKI_MAX_CHARS   = 500;
const OVERPASS_TIMEOUT = 8000;

// ═══════════════════════════════════════════════════════════════════════════════
// ÉTAT GLOBAL
// ═══════════════════════════════════════════════════════════════════════════════

const state = {
  coords:        null,   // {lat, lon}
  nominatim:     null,   // réponse complète Nominatim
  streetFull:    '',     // nom complet de la rue
  streetType:    '',     // type (Avenue, Rue…)
  streetSimple:  '',     // nom simplifié
  cityName:      '',     // ville
  plaques:       [],     // plaques à proximité
  resultType:    '',     // 'street' | 'city'
  wikiCache:     {},     // cache {street|city} → résultat
  mapInstance:   null,   // instance Leaflet
  leafletLoaded: false,
  manualEdit:    false,  // true si l'utilisateur a modifié le nom manuellement
};

// ═══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  el.classList.add('active');
  // Reset scroll
  const scrollable = el.querySelector('.results-body, .plaques-list-wrap, .about-body, .home-content');
  if (scrollable) scrollable.scrollTop = 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARSING DU NOM DE RUE
// ═══════════════════════════════════════════════════════════════════════════════

const PREFIXES = [
  [/^grande?\s+rue\b/i,    'Grande Rue'],
  [/^avenue\b/i,           'Avenue'],
  [/^boulevard\b/i,        'Boulevard'],
  [/^allée[s]?\b/i,        'Allée'],
  [/^impasse\b/i,          'Impasse'],
  [/^place\b/i,            'Place'],
  [/^passage\b/i,          'Passage'],
  [/^cité\b/i,             'Cité'],
  [/^villa\b/i,            'Villa'],
  [/^chemin\b/i,           'Chemin'],
  [/^route\b/i,            'Route'],
  [/^square\b/i,           'Square'],
  [/^voie\b/i,             'Voie'],
  [/^ruelle\b/i,           'Ruelle'],
  [/^sentier\b/i,          'Sentier'],
  [/^sente\b/i,            'Sente'],
  [/^traverse\b/i,         'Traverse'],
  [/^esplanade\b/i,        'Esplanade'],
  [/^cours\b/i,            'Cours'],
  [/^quai\b/i,             'Quai'],
  [/^pont\b/i,             'Pont'],
  [/^rampe\b/i,            'Rampe'],
  [/^montée\b/i,           'Montée'],
  [/^côte\b/i,             'Côte'],
  [/^domaine\b/i,          'Domaine'],
  [/^résidence\b/i,        'Résidence'],
  [/^promenade\b/i,        'Promenade'],
  [/^rond[- ]point\b/i,    'Rond-Point'],
  [/^hameau\b/i,           'Hameau'],
  [/^rue\b/i,              'Rue'],
];
const RE_ARTICLES = /^(de l'|de la |des |du |de |le |la |les |d'|l')/i;

function parseStreet(fullName) {
  let name = fullName.trim(), type = 'Rue';
  for (const [re, label] of PREFIXES) {
    if (re.test(name)) { name = name.replace(re, '').trim(); type = label; break; }
  }
  name = name.replace(RE_ARTICLES, '').trim();
  return { simplified: name || fullName, type };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLASSIFICATION DU NOM (PERSONNE / GÉNÉRIQUE / CONCEPT)
// ═══════════════════════════════════════════════════════════════════════════════

const GENERIC = new Set([
  'beau','belle','bon','bonne','grand','grande','gros','grosse','haut','haute',
  'bas','basse','long','longue','large','vieux','vieille','nouveau','nouvelle',
  'nouveaux','nouvelles','petit','petite','joli','jolie',
  'amis','ami','amie','amour','bonheur','joie','espoir','rêve','paix',
  'liberté','égalité','fraternité','solidarité','justice','progrès','avenir','gloire',
  'fleur','fleurs','rose','roses','lilas','muguet','lavande','iris','violette',
  'marguerite','coquelicot',
  'chêne','platane','tilleul','peuplier','orme','pin','sapin','hêtre','charme',
  'frêne','acacia','mimosa','châtaignier','noyer',
  'bois','forêt','bosquet','prairie','pré','champ','jardin','parc',
  'soleil','lune','étoile','vent','nuage','pluie','neige',
  'rivière','ruisseau','source','fontaine','puits','étang','lac',
  'rocher','roche','pierre','grès','sable','argile',
  'vallée','vallon','coteau','plateau','colline','falaise','plaine','landes',
  'moulin','moulins','four','fours','forge','forges',
  'église','chapelle','abbaye','prieuré','couvent','temple',
  'château','ferme','grange','grenier','cellier',
  'mairie','école','marché','halle','halles','lavoir','gare','port',
  'aigle','lion','loup','renard','cerf','sanglier','colombe','hirondelle','cygne',
  'blanc','blanche','rouge','vert','verte','bleu','bleue','doré','dorée',
  'argenté','argentée','noir','noire','grise','gris',
  'tisserand','potier','tuilier','tanneurs','tonneliers','charpentiers','maçons',
  'cordonniers','boulangers','bouchers','teinturiers',
  'croix','calvaire','marais','vignes','vigne','verger',
]);

function classifyName(name) {
  const words = name.toLowerCase().split(/[\s\-']+/).filter(w => w.length > 2);
  if (!words.length) return 'unknown';
  const genericRatio = words.filter(w => GENERIC.has(w)).length / words.length;
  if (genericRatio >= 0.4) return 'generic';
  // Présence d'un mot capitalisé non-article → probablement un nom propre
  const STOP = new Set(['les','des','rue','avenue','boulevard','de','du','la','le','sur','sous','aux']);
  const hasProper = name.split(/[\s\-]+/).some(w =>
    w.length > 2 && /^[A-ZÀ-Ÿ]/.test(w) && !STOP.has(w.toLowerCase())
  );
  if (hasProper) return 'person';
  return 'concept';
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITAIRES
// ═══════════════════════════════════════════════════════════════════════════════

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function fmtDist(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m/1000).toFixed(1)} km`;
}

async function withTimeout(promise, ms) {
  const t = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
  return Promise.race([promise, t]);
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('visible'), 3200);
}

function linkItem(url, title, domain, icon) {
  return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="link-item">
    <span class="link-icon">${icon}</span>
    <span class="link-text">
      <span class="link-title">${title}</span>
      <span class="link-domain">${domain}</span>
    </span>
    <span class="link-arrow">›</span>
  </a>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// API — NOMINATIM (reverse geocoding)
// ═══════════════════════════════════════════════════════════════════════════════

async function reverseGeocode(lat, lon) {
  const u = new URL('https://nominatim.openstreetmap.org/reverse');
  u.searchParams.set('format', 'json');
  u.searchParams.set('lat', lat);
  u.searchParams.set('lon', lon);
  u.searchParams.set('zoom', '18');
  u.searchParams.set('addressdetails', '1');
  u.searchParams.set('accept-language', 'fr');
  const r = await fetch(u, { headers: { 'User-Agent': 'StreetLore/2.0' } });
  if (!r.ok) throw new Error('Géocodage échoué');
  return r.json();
}

// ═══════════════════════════════════════════════════════════════════════════════
// API — OVERPASS (étymologie OSM + plaques)
// ═══════════════════════════════════════════════════════════════════════════════

async function overpassQuery(ql) {
  const url = 'https://overpass-api.de/api/interpreter';
  const r = await fetch(url, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(ql),
  });
  if (!r.ok) throw new Error('Overpass error');
  return r.json();
}

async function getOSMEtymology(streetName, lat, lon) {
  const safe = streetName.replace(/"/g, '\\"');
  const ql = `[out:json][timeout:6];
    way["name"="${safe}"](around:120,${lat},${lon});
    out tags;`;
  const data = await withTimeout(overpassQuery(ql), OVERPASS_TIMEOUT);
  if (!data.elements?.length) return null;
  const tags = data.elements[0].tags;
  return {
    wikidata:  tags['name:etymology:wikidata']  || null,
    wikipedia: tags['name:etymology:wikipedia'] || null,
    text:      tags['name:etymology']           || null,
  };
}

async function fetchOSMPlaques(lat, lon) {
  const r = PLAQUE_RADIUS_M;
  const ql = `[out:json][timeout:10];
    (
      node["historic"="memorial"](around:${r},${lat},${lon});
      node["historic"="plaque"](around:${r},${lat},${lon});
      node["memorial"~"plaque|blue_plaque|war_memorial"](around:${r},${lat},${lon});
    );
    out body;`;
  const data = await withTimeout(overpassQuery(ql), 12000);
  return (data.elements || []).map(n => {
    const t = n.tags || {};
    // Wikimedia Commons thumbnail
    let photo = null;
    if (t.image) photo = t.image;
    else if (t.wikimedia_commons) {
      const file = t.wikimedia_commons.replace(/^File:/i, '');
      photo = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=400`;
    }
    // Wikipedia link
    let wikiUrl = null;
    if (t.wikipedia) {
      const [lang, ...rest] = t.wikipedia.split(':');
      wikiUrl = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(rest.join(':'))}`;
    }
    return {
      id:          `osm-${n.id}`,
      name:        t.name || t.inscription?.split('\n')[0] || 'Plaque commémorative',
      inscription: t.inscription || t.description || null,
      lat:         n.lat,
      lon:         n.lon,
      photo,
      wikiUrl,
      source:      'osm',
      distance:    haversine(lat, lon, n.lat, n.lon),
    };
  });
}

async function fetchOpenPlaques(lat, lon) {
  const delta = PLAQUE_RADIUS_M / 111000;
  const url = `https://openplaques.org/plaques.json?` +
    `box[sw_lat]=${(lat-delta).toFixed(6)}&box[sw_lng]=${(lon-delta).toFixed(6)}` +
    `&box[ne_lat]=${(lat+delta).toFixed(6)}&box[ne_lng]=${(lon+delta).toFixed(6)}`;
  const r = await withTimeout(fetch(url), 8000);
  if (!r.ok) return [];
  const data = await r.json();
  return (Array.isArray(data) ? data : [])
    .filter(p => p.latitude && p.longitude)
    .map(p => ({
      id:          `op-${p.id}`,
      name:        p.lead_subject?.name || p.inscription?.split('\n')[0] || 'Plaque',
      inscription: p.inscription || null,
      lat:         parseFloat(p.latitude),
      lon:         parseFloat(p.longitude),
      photo:       p.photos?.[0]?.large_url || p.photos?.[0]?.thumbnail_url || null,
      wikiUrl:     null,
      source:      'openplaques',
      distance:    haversine(lat, lon, parseFloat(p.latitude), parseFloat(p.longitude)),
    }));
}

async function fetchAllPlaques(lat, lon) {
  const [osm, op] = await Promise.allSettled([
    fetchOSMPlaques(lat, lon),
    fetchOpenPlaques(lat, lon),
  ]);
  const osmList = osm.status === 'fulfilled' ? osm.value : [];
  const opList  = op.status  === 'fulfilled' ? op.value  : [];
  // Dédoublonnage grossier par distance (< 30m = même plaque)
  const merged = [...osmList];
  for (const p of opList) {
    const dup = merged.some(m => haversine(m.lat, m.lon, p.lat, p.lon) < 30);
    if (!dup) merged.push(p);
  }
  return merged.sort((a, b) => a.distance - b.distance);
}

// ═══════════════════════════════════════════════════════════════════════════════
// API — WIKIDATA → titre Wikipedia FR
// ═══════════════════════════════════════════════════════════════════════════════

async function wikidataToWikiTitle(qid) {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  const r = await withTimeout(fetch(url), 6000);
  if (!r.ok) return null;
  const data = await r.json();
  return data.entities?.[qid]?.sitelinks?.frwiki?.title || null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// API — WIKIPEDIA FR
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchWikiSummary(title) {
  const url = `https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const r = await withTimeout(fetch(url), 7000);
  if (!r.ok) return null;
  return r.json();
}

async function searchWikipedia(query) {
  const u = new URL('https://fr.wikipedia.org/w/api.php');
  u.searchParams.set('action', 'query');
  u.searchParams.set('list', 'search');
  u.searchParams.set('srsearch', query);
  u.searchParams.set('format', 'json');
  u.searchParams.set('origin', '*');
  u.searchParams.set('srlimit', '5');
  const r = await withTimeout(fetch(u), 7000);
  if (!r.ok) return null;
  const data = await r.json();
  const results = data.query?.search ?? [];
  for (const res of results) {
    const s = await fetchWikiSummary(res.title);
    if (s && s.type !== 'disambiguation') return s;
  }
  return results.length ? fetchWikiSummary(results[0].title) : null;
}

// Extrait les phrases mentionnant la ville (contexte local)
function extractLocalContext(wiki, city) {
  if (!wiki?.extract || !city) return null;
  const norm = city.toLowerCase().replace(/-/g, ' ');
  if (!wiki.extract.toLowerCase().includes(norm)) return null;
  const sentences = wiki.extract.split(/(?<=[.!?])\s+/);
  const relevant = sentences.filter(s => s.toLowerCase().includes(norm));
  return relevant.length ? relevant.slice(0, 2).join(' ') : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECHERCHE INTELLIGENTE (3 couches)
// ═══════════════════════════════════════════════════════════════════════════════

async function smartSearch(simplified, fullStreet, city, lat, lon) {
  // ── Couche 1 : Étymologie OSM (Wikidata) ─────────────────────────────────
  try {
    const etym = await getOSMEtymology(fullStreet, lat, lon);
    if (etym?.wikidata) {
      const title = await wikidataToWikiTitle(etym.wikidata);
      if (title) {
        const wiki = await fetchWikiSummary(title);
        if (wiki?.extract) {
          return {
            source:       'wikidata',
            wiki,
            etymText:     etym.text,
            localContext: extractLocalContext(wiki, city),
          };
        }
      }
    }
    // Étymologie textuelle sans Wikidata
    if (etym?.text) {
      return { source: 'etymology-text', wiki: null, etymText: etym.text, localContext: null };
    }
  } catch { /* silencieux */ }

  // ── Couche 2 : Classification ─────────────────────────────────────────────
  const type = classifyName(simplified);
  if (type === 'generic') {
    return { source: 'generic', wiki: null, etymText: null, localContext: null };
  }

  // ── Couche 3 : Wikipedia avec contexte ville ──────────────────────────────
  try {
    const wiki = await searchWikipedia(simplified);
    if (wiki?.extract) {
      return {
        source:       'wikipedia',
        wiki,
        etymText:     null,
        localContext: extractLocalContext(wiki, city),
      };
    }
  } catch { /* silencieux */ }

  return { source: 'notfound', wiki: null, etymText: null, localContext: null };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDU — ÉCRAN ACCUEIL
// ═══════════════════════════════════════════════════════════════════════════════

function renderHome() {
  const addr = state.nominatim.address;
  const city = addr.city || addr.town || addr.village || addr.municipality || '';
  state.cityName = city;

  document.getElementById('home-street-type').textContent = state.streetType;
  document.getElementById('home-street-name').textContent = state.streetSimple;
  document.getElementById('home-city').textContent = city
    ? `📍 ${[addr.city_district, city].filter(Boolean).join(' · ')}`
    : '';

  document.getElementById('btn-street-sub').textContent = state.streetSimple;
  document.getElementById('btn-city-sub').textContent   = city;

  showScreen('screen-home');

  // Plaques en arrière-plan
  fetchAllPlaques(state.coords.lat, state.coords.lon)
    .then(plaques => {
      state.plaques = plaques;
      document.getElementById('plaques-loading').classList.add('hidden');
      const sec = document.getElementById('plaques-section');
      if (plaques.length > 0) {
        document.getElementById('plaques-label').textContent =
          `${plaques.length} plaque${plaques.length > 1 ? 's' : ''} commémorative${plaques.length > 1 ? 's' : ''}`;
        sec.classList.remove('hidden');
      } else {
        sec.classList.add('hidden');
      }
    })
    .catch(() => {
      document.getElementById('plaques-loading').classList.add('hidden');
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDU — RÉSULTATS (rue ou ville)
// ═══════════════════════════════════════════════════════════════════════════════

function resetResultSkeletons() {
  document.getElementById('wiki-content').innerHTML =
    '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton short"></div>';
  document.getElementById('links-content').innerHTML =
    '<div class="skeleton"></div><div class="skeleton short"></div>';
  document.getElementById('neighborhood-content').innerHTML =
    '<div class="skeleton short"></div>';
  document.getElementById('source-badge').className = 'source-badge hidden';
  document.getElementById('local-section').classList.add('hidden');
}

async function renderResults(type) {
  state.resultType = type;
  resetResultSkeletons();

  const addr      = state.nominatim.address;
  const city      = state.cityName;
  const isStreet  = type === 'street';
  const queryName = isStreet ? state.streetSimple : city;

  // Header
  document.getElementById('result-eyebrow').textContent  = isStreet ? state.streetType : 'Ville';
  document.getElementById('result-name').textContent     = queryName;
  document.getElementById('result-location').textContent =
    [addr.city_district, city].filter(Boolean).join(', ');

  // Quartier : visible seulement pour la rue
  document.getElementById('neighborhood-section').style.display = isStreet ? '' : 'none';

  showScreen('screen-results');

  // ── Quartier (synchrone, uniquement rue) ────────────────────────────────────
  if (isStreet) {
    const items = [];
    const seen = new Set();
    for (const [k, label] of [
      ['neighbourhood','Quartier'],['suburb','Quartier'],
      ['city_district','Arrondissement'],['city','Ville'],
      ['town','Ville'],['village','Village'],
      ['municipality','Commune'],['county','Département'],
      ['postcode','Code postal'],
    ]) {
      if (addr[k] && !seen.has(label)) {
        seen.add(label);
        items.push({ label, value: addr[k] });
      }
      if (items.length >= 4) break;
    }
    const nbEl = document.getElementById('neighborhood-content');
    if (items.length) {
      const grid = items.map(({ label, value }) =>
        `<div class="nb-item"><p class="nb-label">${label}</p><p class="nb-value">${value}</p></div>`
      ).join('');
      const { lat, lon } = state.coords;
      nbEl.innerHTML = `<div class="nb-grid">${grid}</div>
        <a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}"
           target="_blank" rel="noopener" class="map-link">🗺️ Voir sur OpenStreetMap</a>`;
    } else {
      nbEl.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Informations non disponibles.</p>';
    }
  }

  // ── Wikipedia (asynchrone) ─────────────────────────────────────────────────
  const cacheKey = type;
  if (!state.wikiCache[cacheKey]) {
    state.wikiCache[cacheKey] = isStreet
      ? smartSearch(state.streetSimple, state.streetFull, city, state.coords.lat, state.coords.lon)
      : searchWikipedia(city).then(wiki => ({ source: 'wikipedia', wiki, etymText: null, localContext: null }));
  }

  let result;
  try {
    result = await state.wikiCache[cacheKey];
  } catch {
    result = { source: 'notfound', wiki: null };
  }

  renderWikiSection(result, queryName, city);
}

function renderWikiSection(result, queryName, city) {
  const wikiEl  = document.getElementById('wiki-content');
  const linksEl = document.getElementById('links-content');
  const badge   = document.getElementById('source-badge');

  // ── Badge source ────────────────────────────────────────────────────────────
  if (result.source === 'wikidata') {
    badge.className  = 'source-badge verified';
    badge.innerHTML  = '✓ Source certifiée — étymologie OpenStreetMap / Wikidata';
  } else if (result.source === 'wikipedia') {
    badge.className  = 'source-badge approximate';
    badge.innerHTML  = '◎ Résultat Wikipedia — pertinence estimée';
  } else if (result.source === 'generic') {
    badge.className  = 'source-badge generic';
    badge.innerHTML  = '◌ Nom d\'usage local — pas de personnage historique identifié';
  } else if (result.source === 'etymology-text') {
    badge.className  = 'source-badge verified';
    badge.innerHTML  = '✓ Étymologie OpenStreetMap';
  }

  // ── Cas : étymologie textuelle sans Wikipedia ───────────────────────────────
  if (result.source === 'etymology-text' && result.etymText) {
    wikiEl.innerHTML = `<p class="wiki-extract">${result.etymText}</p>`;
    renderLinks(linksEl, null, queryName, city);
    return;
  }

  // ── Cas : nom générique ─────────────────────────────────────────────────────
  if (result.source === 'generic') {
    wikiEl.innerHTML = `<div class="empty-state">
      <p class="empty-icon">🏷️</p>
      <p>Cette rue porte un <strong>nom d'usage local</strong> — nature, métier, qualificatif — sans personnage ou événement historique précis.<br><br>
      Les archives municipales de ${city || 'la ville'} peuvent en retracer l'origine.</p>
    </div>`;
    const archivesQ = encodeURIComponent(`archives municipales ${city} noms rues`);
    linksEl.innerHTML =
      linkItem(`https://www.google.com/search?q=${archivesQ}`, `Archives de ${city}`, 'google.com', '🗄️') +
      linkItem(`https://fr.wikipedia.org/w/index.php?search=${encodeURIComponent(queryName)}`,
        'Chercher sur Wikipédia', 'fr.wikipedia.org', '📖');
    return;
  }

  // ── Cas : rien trouvé ──────────────────────────────────────────────────────
  if (!result.wiki?.extract) {
    wikiEl.innerHTML = `<div class="empty-state">
      <p class="empty-icon">🔍</p>
      <p>Aucune information trouvée sur Wikipédia pour <strong>${queryName}</strong>.</p>
    </div>`;
    renderLinks(linksEl, null, queryName, city);
    return;
  }

  // ── Cas normal : Wikipedia ─────────────────────────────────────────────────
  const wiki    = result.wiki;
  const extract = wiki.extract.length > WIKI_MAX_CHARS
    ? wiki.extract.slice(0, WIKI_MAX_CHARS).replace(/\s+\S*$/, '') + '…'
    : wiki.extract;

  let html = '';
  if (wiki.thumbnail?.source) {
    html += `<img src="${wiki.thumbnail.source}" class="wiki-thumb" alt="${wiki.title}" loading="lazy">`;
  }
  if (result.source === 'wikidata' || wiki.title?.toLowerCase() !== queryName.toLowerCase()) {
    const label = result.source === 'wikidata' ? 'Identifié par étymologie' : 'Article';
    html += `<p class="wiki-origin">${label} : <strong>${wiki.title}</strong></p>`;
  }
  html += `<p class="wiki-extract">${extract}</p>`;
  wikiEl.innerHTML = html;

  // Contexte local
  if (result.localContext) {
    const localSec = document.getElementById('local-section');
    document.getElementById('local-title').textContent = `Lien avec ${city}`;
    document.getElementById('local-content').innerHTML =
      `<p class="local-text">${result.localContext}</p>`;
    localSec.classList.remove('hidden');
  }

  renderLinks(linksEl, wiki, queryName, city);
}

function renderLinks(el, wiki, queryName, city) {
  const wikiUrl  = wiki?.content_urls?.mobile?.page ?? wiki?.content_urls?.desktop?.page ?? '';
  const googleQ  = encodeURIComponent(`${queryName} ${city} histoire`);
  const mapsQ    = encodeURIComponent(`${state.streetFull || queryName} ${city}`);
  el.innerHTML =
    (wikiUrl ? linkItem(wikiUrl, `${wiki.title} — Wikipédia`, 'fr.wikipedia.org', '📖') : '') +
    linkItem(`https://fr.wikipedia.org/w/index.php?search=${encodeURIComponent(queryName)}`,
      'Chercher sur Wikipédia', 'fr.wikipedia.org', '🔎') +
    linkItem(`https://www.google.com/search?q=${googleQ}`, 'Rechercher sur Google', 'google.com', '🔍') +
    linkItem(`https://www.google.com/maps/search/${mapsQ}`, 'Voir sur Google Maps', 'maps.google.com', '📍');
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDU — PLAQUES + CARTE LEAFLET
// ═══════════════════════════════════════════════════════════════════════════════

async function loadLeaflet() {
  if (state.leafletLoaded) return;
  await new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel  = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src     = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload  = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  state.leafletLoaded = true;
}

async function renderPlaques() {
  const { lat, lon } = state.coords;
  const addr = state.nominatim.address;
  const city = state.cityName;

  document.getElementById('plaques-location').textContent =
    `${state.plaques.length} trouvée${state.plaques.length > 1 ? 's' : ''} · rayon 500 m · ${city}`;

  showScreen('screen-plaques');

  // ── Leaflet ───────────────────────────────────────────────────────────────
  try {
    await loadLeaflet();
    const mapEl = document.getElementById('map-container');

    if (state.mapInstance) {
      state.mapInstance.remove();
      state.mapInstance = null;
    }

    const map = L.map(mapEl, { zoomControl: false }).setView([lat, lon], 16);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    // Marqueur utilisateur
    const userIcon = L.divIcon({
      className: '',
      html: '<div style="width:14px;height:14px;background:#f59e0b;border:3px solid #fff;border-radius:50%;box-shadow:0 0 8px rgba(245,158,11,0.6)"></div>',
      iconAnchor: [7, 7],
    });
    L.marker([lat, lon], { icon: userIcon }).addTo(map).bindPopup('<strong>Vous êtes ici</strong>');

    // Marqueurs plaques
    const plaqueIcon = L.divIcon({
      className: '',
      html: '<div style="width:12px;height:12px;background:#3b82f6;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(59,130,246,0.5)"></div>',
      iconAnchor: [6, 6],
    });

    for (const p of state.plaques) {
      L.marker([p.lat, p.lon], { icon: plaqueIcon })
        .addTo(map)
        .bindPopup(`<strong>${p.name}</strong><br><small>${fmtDist(p.distance)}</small>`);
    }

    state.mapInstance = map;
  } catch (e) {
    document.getElementById('map-container').innerHTML =
      '<p style="color:var(--muted);font-size:.85rem;padding:1rem;text-align:center">Carte non disponible</p>';
  }

  // ── Liste des plaques ─────────────────────────────────────────────────────
  const list = document.getElementById('plaques-list');
  if (!state.plaques.length) {
    list.innerHTML = `<div class="plaques-empty">
      <p>🏅</p><p>Aucune plaque commémorative<br>recensée dans un rayon de 500 m.</p>
    </div>`;
    return;
  }

  list.innerHTML = state.plaques.map((p, i) => {
    const thumbHtml = p.photo
      ? `<img src="${p.photo}" class="plaque-thumb" alt="${p.name}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\"plaque-thumb-placeholder\\">🏅</div>'">`
      : `<div class="plaque-thumb-placeholder">🏅</div>`;
    const wikiLink = p.wikiUrl
      ? `<a href="${p.wikiUrl}" target="_blank" rel="noopener" class="plaque-wiki-link">📖 Voir sur Wikipédia</a>`
      : '';
    const inscription = p.inscription
      ? `<p class="plaque-inscription">"${p.inscription.slice(0, 300)}${p.inscription.length > 300 ? '…' : ''}"</p>`
      : '';
    const bigPhoto = p.photo
      ? `<img src="${p.photo}" class="plaque-photo" alt="${p.name}" loading="lazy">`
      : '';
    return `<div class="plaque-item" data-idx="${i}">
      <div class="plaque-summary">
        ${thumbHtml}
        <div class="plaque-info">
          <p class="plaque-name">${p.name}</p>
          <p class="plaque-dist">${fmtDist(p.distance)} · ${p.source === 'openplaques' ? 'OpenPlaques' : 'OpenStreetMap'}</p>
        </div>
        <span class="plaque-chevron">›</span>
      </div>
      <div class="plaque-detail">
        <div class="plaque-detail-inner">
          ${bigPhoto}
          ${inscription}
          ${wikiLink}
        </div>
      </div>
    </div>`;
  }).join('');

  // Expand/collapse
  list.querySelectorAll('.plaque-summary').forEach(el => {
    el.addEventListener('click', () => {
      const item = el.closest('.plaque-item');
      const wasOpen = item.classList.contains('open');
      list.querySelectorAll('.plaque-item').forEach(i => i.classList.remove('open'));
      if (!wasOpen) {
        item.classList.add('open');
        // Centre la carte sur la plaque
        if (state.mapInstance) {
          const idx = parseInt(item.dataset.idx);
          const p = state.plaques[idx];
          state.mapInstance.flyTo([p.lat, p.lon], 17, { duration: 0.8 });
        }
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTAGER
// ═══════════════════════════════════════════════════════════════════════════════

async function share() {
  const name     = document.getElementById('result-name').textContent;
  const location = document.getElementById('result-location').textContent;
  const appUrl   = 'https://yvesmorel888.github.io/streetlore/';
  const text     = `${name} (${location}) — découvert avec StreetLore`;
  try {
    if (navigator.share) {
      await navigator.share({ title: `StreetLore · ${name}`, text, url: appUrl });
    } else {
      await navigator.clipboard.writeText(`${text}\n${appUrl}`);
      showToast('📋 Copié dans le presse-papier');
    }
  } catch { /* annulé par l'utilisateur */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GPS + FLUX PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

function setSplashText(t) { document.getElementById('splash-text').textContent = t; }

async function locateAndLoad() {
  // Réinitialise le cache et le mode manuel
  state.wikiCache   = {};
  state.plaques     = [];
  state.manualEdit  = false;
  document.getElementById('manual-notice').classList.add('hidden');
  document.getElementById('edit-name-form').classList.remove('visible');

  showScreen('screen-splash');
  document.getElementById('btn-retry').classList.add('hidden');
  document.getElementById('splash-spinner').style.display = '';
  setSplashText('Localisation en cours…');

  // Réinitialise la section plaques
  document.getElementById('plaques-section').classList.add('hidden');
  document.getElementById('plaques-loading').classList.remove('hidden');

  if (!navigator.geolocation) {
    showSplashError('La géolocalisation n\'est pas supportée par ce navigateur.');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      state.coords = { lat, lon };
      setSplashText('Identification de la rue…');
      try {
        const data = await reverseGeocode(lat, lon);
        state.nominatim = data;
        const road = data.address?.road || data.address?.pedestrian ||
                     data.address?.footway || data.address?.path || '';
        if (!road) {
          showSplashError('Aucune rue identifiée ici. Essayez depuis une rue.');
          return;
        }
        state.streetFull = road;
        const { simplified, type } = parseStreet(road);
        state.streetSimple = simplified;
        state.streetType   = type;
        renderHome();
      } catch {
        showSplashError('Erreur réseau. Vérifiez votre connexion internet.');
      }
    },
    err => {
      if (err.code === 1)
        showSplashError('Position refusée. Autorisez la géolocalisation dans les réglages du navigateur.');
      else if (err.code === 3)
        showSplashError('Délai GPS dépassé. Réessayez à l\'extérieur ou en déplaçant le téléphone.');
      else
        showSplashError('Position indisponible. Réessayez dans quelques instants.');
    },
    { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 0 }
  );
}

function showSplashError(msg) {
  document.getElementById('splash-spinner').style.display = 'none';
  setSplashText(msg);
  document.getElementById('btn-retry').classList.remove('hidden');
}

// ═══════════════════════════════════════════════════════════════════════════════
// ÉVÉNEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

document.getElementById('btn-retry').addEventListener('click', locateAndLoad);
document.getElementById('btn-relocate').addEventListener('click', locateAndLoad);

// ── Édition manuelle du nom de rue ────────────────────────────────────────────
document.getElementById('btn-edit-name').addEventListener('click', () => {
  const form  = document.getElementById('edit-name-form');
  const input = document.getElementById('edit-name-input');
  form.classList.toggle('visible');
  if (form.classList.contains('visible')) {
    input.value = state.streetSimple;
    input.focus();
    input.select();
  }
});

document.getElementById('btn-edit-cancel').addEventListener('click', () => {
  document.getElementById('edit-name-form').classList.remove('visible');
});

document.getElementById('btn-edit-confirm').addEventListener('click', applyManualEdit);
document.getElementById('edit-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') applyManualEdit();
  if (e.key === 'Escape') document.getElementById('edit-name-form').classList.remove('visible');
});

function applyManualEdit() {
  const input = document.getElementById('edit-name-input');
  const raw   = input.value.trim();
  if (!raw) return;

  // Détecte et retire le préfixe de type si l'utilisateur l'a inclus
  const { simplified, type } = parseStreet(raw);
  state.streetSimple = simplified;
  state.streetType   = type;
  state.streetFull   = raw;
  state.manualEdit   = true;
  state.wikiCache    = {}; // invalide le cache

  // Met à jour l'affichage
  document.getElementById('home-street-type').textContent = type;
  document.getElementById('home-street-name').textContent = simplified;
  document.getElementById('btn-street-sub').textContent   = simplified;

  // Ferme le formulaire
  document.getElementById('edit-name-form').classList.remove('visible');

  // Affiche la notice et masque les plaques
  document.getElementById('manual-notice').classList.remove('hidden');
  document.getElementById('plaques-section').classList.add('hidden');
  document.getElementById('plaques-loading').classList.add('hidden');

  showToast(`✏️ Nom modifié : ${simplified}`);
}

document.getElementById('btn-street').addEventListener('click', () => renderResults('street'));
document.getElementById('btn-city').addEventListener('click',   () => renderResults('city'));

document.getElementById('btn-plaques').addEventListener('click', renderPlaques);

document.getElementById('btn-about').addEventListener('click', () => showScreen('screen-about'));

document.getElementById('btn-back-results').addEventListener('click', () => showScreen('screen-home'));
document.getElementById('btn-back-plaques').addEventListener('click', () => showScreen('screen-home'));
document.getElementById('btn-back-about').addEventListener('click',   () => showScreen('screen-home'));

document.getElementById('btn-share').addEventListener('click', share);

// ═══════════════════════════════════════════════════════════════════════════════
// PWA SERVICE WORKER
// ═══════════════════════════════════════════════════════════════════════════════

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════

locateAndLoad();
