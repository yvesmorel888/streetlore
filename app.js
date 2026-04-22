'use strict';

// ─── État global ──────────────────────────────────────────────────────────────

const state = {
  coords: null,
  streetFull: '',
  streetType: '',
  streetSimplified: '',
  nominatimData: null,
};

// ─── Navigation entre écrans ──────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  target.classList.add('active');
  if (id === 'screen-results') target.scrollTop = 0;
}

// ─── Parsing du nom de rue ────────────────────────────────────────────────────

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
  [/^sente\b/i,            'Sente'],
  [/^sentier\b/i,          'Sentier'],
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

const ARTICLES = /^(de l'|de la |des |du |de |le |la |les |d'|l')/i;

function parseStreet(fullName) {
  let name = fullName.trim();
  let type = 'Rue';
  for (const [re, label] of PREFIXES) {
    if (re.test(name)) {
      name = name.replace(re, '').trim();
      type = label;
      break;
    }
  }
  name = name.replace(ARTICLES, '').trim();
  return { simplified: name || fullName, type };
}

// ─── API Nominatim ────────────────────────────────────────────────────────────

async function reverseGeocode(lat, lon) {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'json');
  url.searchParams.set('lat', lat);
  url.searchParams.set('lon', lon);
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('accept-language', 'fr');
  const res = await fetch(url, { headers: { 'User-Agent': 'StreetLore/1.0' } });
  if (!res.ok) throw new Error('Géocodage échoué');
  return res.json();
}

// ─── API Wikipedia (français) ─────────────────────────────────────────────────

async function fetchWikiSummary(title) {
  const url = `https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function searchWikipedia(query) {
  const url = new URL('https://fr.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('list', 'search');
  url.searchParams.set('srsearch', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  url.searchParams.set('srlimit', '5');

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const results = data.query?.search ?? [];
  if (!results.length) return null;

  // Essai en ordre, on saute les pages de désambiguïsation
  for (const r of results) {
    const summary = await fetchWikiSummary(r.title);
    if (summary && summary.type !== 'disambiguation') return summary;
  }
  // Sinon on retourne le premier quand même
  return fetchWikiSummary(results[0].title);
}

// ─── Rendu des résultats ──────────────────────────────────────────────────────

function getNeighborhoodItems(address) {
  const candidates = [
    ['neighbourhood', 'Quartier'],
    ['suburb',        'Quartier'],
    ['city_district', 'Arrondissement'],
    ['city',          'Ville'],
    ['town',          'Ville'],
    ['village',       'Village'],
    ['municipality',  'Commune'],
    ['county',        'Département'],
    ['postcode',      'Code postal'],
  ];
  const seen = new Set();
  const items = [];
  for (const [key, label] of candidates) {
    if (address[key] && !seen.has(label)) {
      seen.add(label);
      items.push({ label, value: address[key] });
    }
    if (items.length >= 4) break;
  }
  return items;
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

function resetSkeletons() {
  document.getElementById('wiki-content').innerHTML =
    '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton short"></div>';
  document.getElementById('links-content').innerHTML =
    '<div class="skeleton"></div><div class="skeleton short"></div>';
  document.getElementById('neighborhood-content').innerHTML =
    '<div class="skeleton short"></div>';
}

async function renderResults(simplified, nominatimData) {
  const addr = nominatimData.address;
  const city = addr.city || addr.town || addr.village || addr.municipality || '';
  const district = addr.city_district || '';
  const location = [district, city].filter(Boolean).join(', ');

  document.getElementById('result-street-type').textContent = state.streetType;
  document.getElementById('result-street-name').textContent = simplified;
  document.getElementById('result-location').textContent = location;

  // ── Quartier (synchrone) ─────────────────────────────────────────────────────
  const items = getNeighborhoodItems(addr);
  const nbContent = document.getElementById('neighborhood-content');
  if (items.length) {
    const grid = items.map(({ label, value }) =>
      `<div class="nb-item"><p class="nb-label">${label}</p><p class="nb-value">${value}</p></div>`
    ).join('');
    const mapUrl = `https://www.openstreetmap.org/?mlat=${state.coords.lat}&mlon=${state.coords.lon}#map=17/${state.coords.lat}/${state.coords.lon}`;
    nbContent.innerHTML = `<div class="nb-grid">${grid}</div>
      <a href="${mapUrl}" target="_blank" rel="noopener" class="map-link">🗺️ Voir sur OpenStreetMap</a>`;
  } else {
    nbContent.innerHTML = '<p class="muted">Informations non disponibles.</p>';
  }

  // ── Wikipedia (asynchrone) ───────────────────────────────────────────────────
  const wikiContent  = document.getElementById('wiki-content');
  const linksContent = document.getElementById('links-content');

  try {
    const wiki = await searchWikipedia(simplified);

    if (wiki?.extract) {
      const extract = wiki.extract.length > 480
        ? wiki.extract.slice(0, 480).replace(/\s+\S*$/, '') + '…'
        : wiki.extract;

      let html = '';
      if (wiki.thumbnail?.source) {
        html += `<img src="${wiki.thumbnail.source}" class="wiki-thumb" alt="${wiki.title}" loading="lazy">`;
      }
      if (wiki.title.toLowerCase() !== simplified.toLowerCase()) {
        html += `<p class="wiki-title-found">Article : <strong>${wiki.title}</strong></p>`;
      }
      html += `<p class="wiki-extract">${extract}</p>`;
      wikiContent.innerHTML = html;

      const wikiUrl = wiki.content_urls?.mobile?.page ?? wiki.content_urls?.desktop?.page ?? '';
      const googleQ  = encodeURIComponent(`${simplified} ${city} histoire`);
      const mapsQ    = encodeURIComponent(`${state.streetFull} ${city}`);

      linksContent.innerHTML =
        (wikiUrl ? linkItem(wikiUrl, `${wiki.title} — Wikipédia`, 'fr.wikipedia.org', '📖') : '') +
        linkItem(`https://www.google.com/search?q=${googleQ}`,       'Rechercher sur Google',    'google.com',      '🔍') +
        linkItem(`https://www.google.com/maps/search/${mapsQ}`,      'Voir sur Google Maps',     'maps.google.com', '📍');

    } else {
      wikiContent.innerHTML = `<div class="empty-state">
        <p class="empty-icon">🔍</p>
        <p>Aucune information trouvée sur Wikipédia pour <strong>${simplified}</strong>.<br>
        Vous pouvez essayer de modifier le terme de recherche.</p>
      </div>`;

      const wikiSearch = encodeURIComponent(simplified);
      const googleQ    = encodeURIComponent(`${simplified} ${city}`);
      linksContent.innerHTML =
        linkItem(`https://fr.wikipedia.org/w/index.php?search=${wikiSearch}`, 'Chercher sur Wikipédia', 'fr.wikipedia.org', '📖') +
        linkItem(`https://www.google.com/search?q=${googleQ}`,                'Rechercher sur Google',   'google.com',       '🔍');
    }

  } catch {
    wikiContent.innerHTML = `<div class="empty-state">
      <p class="empty-icon">⚠️</p>
      <p>Impossible de charger les informations.<br>Vérifiez votre connexion internet.</p>
    </div>`;
    linksContent.innerHTML = linkItem(
      `https://fr.wikipedia.org/w/index.php?search=${encodeURIComponent(simplified)}`,
      'Chercher sur Wikipédia', 'fr.wikipedia.org', '📖'
    );
  }
}

// ─── Événements ───────────────────────────────────────────────────────────────

document.getElementById('btn-locate').addEventListener('click', () => {
  if (!navigator.geolocation) {
    showError('La géolocalisation n\'est pas supportée par votre navigateur.');
    return;
  }

  showScreen('screen-loading');
  setLoadingText('Localisation en cours…');

  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      state.coords = { lat, lon };
      setLoadingText('Identification de la rue…');

      try {
        const data = await reverseGeocode(lat, lon);
        state.nominatimData = data;

        const road =
          data.address?.road       ||
          data.address?.pedestrian ||
          data.address?.footway    ||
          data.address?.path       || '';

        if (!road) {
          showScreen('screen-welcome');
          showError('Aucune rue identifiée ici. Essayez depuis une rue.');
          return;
        }

        state.streetFull = road;
        const { simplified, type } = parseStreet(road);
        state.streetSimplified = simplified;
        state.streetType = type;

        document.getElementById('street-full').textContent = road;
        document.getElementById('street-simplified').textContent = simplified;
        document.getElementById('street-edit').value = simplified;
        document.getElementById('simplified-label').textContent =
          simplified === road ? 'Nom de la rue' : 'Simplifié en';

        showScreen('screen-confirm');
      } catch {
        showScreen('screen-welcome');
        showError('Erreur réseau. Vérifiez votre connexion internet.');
      }
    },
    err => {
      showScreen('screen-welcome');
      if (err.code === 1) {
        showError('Position refusée. Autorisez la géolocalisation dans les réglages de votre navigateur.');
      } else if (err.code === 3) {
        showError('Délai dépassé. Réessayez dans un endroit avec un meilleur signal GPS.');
      } else {
        showError('Impossible d\'obtenir votre position. Réessayez.');
      }
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
});

document.getElementById('btn-confirm').addEventListener('click', () => {
  const name = document.getElementById('street-edit').value.trim() || state.streetSimplified;
  state.streetSimplified = name;
  resetSkeletons();
  showScreen('screen-results');
  renderResults(name, state.nominatimData);
});

document.getElementById('btn-back').addEventListener('click', () => showScreen('screen-welcome'));
document.getElementById('btn-home').addEventListener('click', () => showScreen('screen-welcome'));

document.getElementById('street-edit').addEventListener('input', e => {
  const val = e.target.value;
  document.getElementById('street-simplified').textContent = val || state.streetSimplified;
});

function setLoadingText(text) {
  document.getElementById('loading-text').textContent = text;
}

function showError(msg) {
  const banner = document.getElementById('error-banner');
  document.getElementById('error-msg').textContent = msg;
  banner.classList.add('visible');
  setTimeout(() => banner.classList.remove('visible'), 5000);
}

// ─── PWA Service Worker ───────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
