const IMMOWEB_BASE = 'https://www.immoweb.be';
const HONESTY_BASE = 'https://www.honesty.be';
const WIMMO_BASE = 'https://www.wimmobiliere.com';
const ERA_BASE = 'https://www.era.be';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

// Zone cible : Arlon, Attert, Habay, Messancy (frontière luxembourgeoise)
const REGION_POSTALS = {
  arlon: ['6700', '6704', '6706'],
  attert: ['6717'],
  habay: ['6720', '6721', '6723', '6724'],
  messancy: ['6780', '6781', '6782'],
};
const ZONE_POSTALS = new Set(Object.values(REGION_POSTALS).flat());

// Villages de chaque commune, pour reconnaître la localité dans le texte des annonces
const REGION_MATCH = {
  arlon: /\b(6700|6704|6706)\b|arlon|bonnert|heinsch|autelbas|toernich|udange|guirsch|frassem|waltzing/i,
  attert: /\b6717\b|attert|nobressart|nothomb|thiaumont|tontelange|metzert|grendel/i,
  habay: /\b672[0134]\b|habay|anlier|marbehan|rulles|houdemont|hachy/i,
  messancy: /\b678[012]\b|messancy|wolkrange|hondelange|habergy|s[ée]lange|buvange|turpange/i,
};
const ZONE_RE = new RegExp(Object.values(REGION_MATCH).map((r) => r.source).join('|'), 'i');

// Mentions qui excluent un bien "4 façades" (maison mitoyenne, 2-3 façades…)
const NOT_DETACHED_RE = /(2|3|deux|trois)\s*fa[çc]ades|mitoyen|jumel[ée]|semi-?detached|maison de (ville|rang[ée]e)|row\s*house|town\s*house/i;

// Sous-types Immoweb structurellement incompatibles avec une maison 4 façades
const ATTACHED_SUBTYPES = new Set(['TOWN_HOUSE', 'APARTMENT_BLOCK', 'MIXED_USE_BUILDING']);

function timeout(ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

async function fetchText(url, extraHeaders = {}) {
  const { signal, clear } = timeout(7000);
  try {
    const resp = await fetch(url, {
      signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'fr-BE,fr;q=0.9',
        ...extraHeaders,
      },
    });
    const text = await resp.text();
    clear();
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return text;
  } catch (e) {
    clear();
    throw e;
  }
}

function stripTags(s) {
  return s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Les lookarounds evitent de fusionner un code postal avec le prix qui le suit
// ("Attert 6717 400.000 €" doit donner 400000, pas 6717400000)
const PRICE_RE = /(?<!\d)(\d{1,3}(?:[.\s\u00a0\u202f]\d{3})+|\d{5,7})(?!\d)\s*€|€\s*(?<!\d)(\d{1,3}(?:[.\s\u00a0\u202f]\d{3})+|\d{5,7})(?!\d)/;

function parsePrice(text) {
  const m = text.match(PRICE_RE);
  if (!m) return 0;
  const n = parseInt((m[1] || m[2] || '').replace(/\D/g, ''), 10);
  return n >= 40000 && n <= 5000000 ? n : 0;
}

// Extracteur générique : toute ancre dont le contenu affiche un prix en € est
// considérée comme une carte d'annonce (les cartes de ces sites sont des <a>)
function extractCards(html, baseUrl) {
  const cards = [];
  const seen = new Set();
  const anchorRe = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html))) {
    const inner = m[2];
    const text = stripTags(inner);
    const price = parsePrice(text);
    if (!price || text.length < 15) continue;
    let url;
    try { url = new URL(m[1], baseUrl).href; } catch { continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    const imgSrc = (inner.match(/<img[^>]*src=["']([^"']+)["']/i) || [])[1] || null;
    let image = null;
    if (imgSrc && !imgSrc.startsWith('data:')) {
      try { image = new URL(imgSrc, baseUrl).href; } catch { /* ignore */ }
    }
    cards.push({ url, text, price, image });
  }
  return cards;
}

function makeTitle(text) {
  const t = text.replace(/(\d{1,3}(?:[.\s  ]\d{3})+|\d{5,7})\s*€/g, '').replace(/\s+/g, ' ').trim();
  return t.length > 80 ? `${t.slice(0, 77)}…` : t || 'Annonce';
}

function extractLocality(text) {
  for (const [, re] of Object.entries(REGION_MATCH)) {
    const m = text.match(re);
    if (m && /[a-z]/i.test(m[0])) return m[0].charAt(0).toUpperCase() + m[0].slice(1).toLowerCase();
  }
  const zip = text.match(/\b(6700|6704|6706|6717|672[0134]|678[012])\b/);
  return zip ? `CP ${zip[0]}` : 'Région d\'Arlon';
}

function cardsToListings(cards, { source, prefix, region, fourFacades, budget, requireZone }) {
  return cards
    // Zone : on écarte ce qui est localisé hors zone ; sans info, bénéfice du doute
    .filter((c) => !requireZone || !/\b\d{4}\b/.test(c.text) || ZONE_RE.test(c.text))
    .filter((c) => !region || !REGION_MATCH[region] || !ZONE_RE.test(c.text) || REGION_MATCH[region].test(c.text))
    .filter((c) => !fourFacades || !NOT_DETACHED_RE.test(c.text))
    .filter((c) => !budget || !c.price || c.price <= budget)
    .slice(0, 12)
    .map((c) => ({
      id: `${prefix}-${c.url.replace(/\W+/g, '').slice(-28)}`,
      title: makeTitle(c.text),
      type: 'Maison',
      location: extractLocality(c.text),
      price: c.price,
      surface: parseInt((c.text.match(/(\d{2,4})\s*m²/) || [])[1] || '0', 10),
      rooms: 0,
      bedrooms: parseInt((c.text.match(/(\d{1,2})\s*(?:chambres?|ch\b)/i) || [])[1] || '0', 10),
      source,
      isNew: false,
      daysAgo: null,
      url: c.url,
      image: c.image,
    }));
}

// ── Immoweb (API JSON) ───────────────────────────────────────────────────────
async function fetchImmoweb({ region, budget, fourFacades }) {
  const zips = region && REGION_POSTALS[region]
    ? REGION_POSTALS[region]
    : [...ZONE_POSTALS];
  let apiUrl = `${IMMOWEB_BASE}/fr/search-results?countries=BE&postalCodes=${zips.join(',')}&transactionTypes=FOR_SALE&propertyTypes=HOUSE&orderBy=newest&size=30&page=1`;
  // Filtre à la source : même critère que "Façades : 4 ou plus" sur immoweb.be
  if (fourFacades) apiUrl += '&minFacadeCount=4';

  const { signal, clear } = timeout(7000);
  let data;
  try {
    const resp = await fetch(apiUrl, {
      signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, */*; q=0.01',
        'Accept-Language': 'fr-BE,fr;q=0.9',
        'Referer': `${IMMOWEB_BASE}/fr/recherche/maison/a-vendre/arlon/6700`,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    data = await resp.json();
    clear();
  } catch (e) { clear(); throw e; }

  let results = data.results || [];

  // Garde-fou : si l'API ignore postalCodes, on écarte tout bien hors zone
  // (code postal connu). Les biens sans code postal sont gardés.
  results = results.filter((item) => {
    const zip = String(item.property?.location?.postalCode || '');
    return !zip || ZONE_POSTALS.has(zip);
  });

  if (region && REGION_POSTALS[region]) {
    const filtered = results.filter((item) =>
      REGION_POSTALS[region].includes(String(item.property?.location?.postalCode || '')));
    // Aucune annonce dans la commune → on montre toute la zone
    if (filtered.length > 0) results = filtered;
  }

  // Ceinture et bretelles derrière minFacadeCount : on exclut tout bien dont
  // les données contredisent "4 façades" ; sans donnée, bénéfice du doute
  if (fourFacades) {
    results = results.filter((item) => {
      const facades = item.property?.building?.facadeCount;
      if (facades != null && Number(facades) > 0) return Number(facades) >= 4;
      const subtype = (item.property?.subtype || '').toUpperCase();
      if (ATTACHED_SUBTYPES.has(subtype)) return false;
      return !NOT_DETACHED_RE.test(item.property?.title || '');
    });
  }

  if (budget) {
    results = results.filter((item) => {
      const price = item.price?.mainValue || item.transaction?.sale?.price || 0;
      return !price || price <= budget;
    });
  }

  return results.slice(0, 12).map((item) => {
    const prop = item.property || {};
    const price = item.price?.mainValue || item.transaction?.sale?.price || 0;
    const pubDate = item.publication?.lastModificationDate;
    const daysAgo = pubDate
      ? Math.max(0, Math.round((Date.now() - new Date(pubDate)) / 86400000))
      : null;
    const city = prop.location?.locality || 'Arlon';
    const subtype = (prop.subtype || '').toUpperCase();

    return {
      id: `iw-${item.id}`,
      title: prop.title || `${subtype === 'VILLA' ? 'Villa' : 'Maison'} - ${city}`,
      type: subtype === 'VILLA' ? 'Villa' : 'Maison',
      location: city,
      price,
      surface: prop.netHabitableSurface || prop.landSurface || 0,
      rooms: prop.roomCount || 0,
      bedrooms: prop.bedroomCount || 0,
      source: 'immoweb',
      isNew: daysAgo != null && daysAgo <= 3,
      daysAgo,
      url: `${IMMOWEB_BASE}/fr/annonce/${item.id}`,
      image: item.media?.pictures?.[0]?.mediumUrl || item.media?.pictures?.[0]?.smallUrl || null,
    };
  });
}

// ── Honesty (recherche de l'utilisateur, tous biens puis filtre zone) ────────
async function fetchHonesty({ region, budget, fourFacades }) {
  const url = `${HONESTY_BASE}/biens-a-vendre/?purpose=%5B1%2C3%5D&displayStatusIdList=%5B2%5D&category=1&orderByField=Zip&orderSorting=ASC&maxprice=${budget || 600000}`;
  const html = await fetchText(url);
  const cards = extractCards(html, HONESTY_BASE);
  if (cards.length === 0) throw new Error('honesty: 0 annonces parsées (structure de page inconnue ?)');
  return cardsToListings(cards, { source: 'honesty', prefix: 'hon', region, fourFacades, budget, requireZone: true });
}

// ── W Immobilière (recherche de l'utilisateur, codes postaux de la zone) ─────
async function fetchWimmo({ region, budget, fourFacades }) {
  const zips = region && REGION_POSTALS[region] ? REGION_POSTALS[region] : [...ZONE_POSTALS];
  const zipParams = zips.map((z) => `&Zips%5B%5D=${z}`).join('');
  const max = budget || 600000;
  const url = `${WIMMO_BASE}/rechercher/biens?SortFields=ID+DESC&Goal=0&WebIDs=1${zipParams}&PriceTo=${max}&Price=%7C${max}`;
  const html = await fetchText(url);
  const cards = extractCards(html, WIMMO_BASE);
  if (cards.length === 0) throw new Error('wimmo: 0 annonces parsées (structure de page inconnue ?)');
  return cardsToListings(cards, { source: 'wimmo', prefix: 'wim', region, fourFacades, budget, requireZone: false });
}

// ── ERA (recherche de l'utilisateur : agence Sud-Luxembourg, ses communes) ───
async function fetchEra({ region, budget, fourFacades }) {
  const max = budget || 600000;
  const url = `${ERA_BASE}/fr/a-vendre?pager%5Blimit%5D=24&broker_id=6000144`
    + '&filter%5Blocation%5D%5Bmunicipalities%5D=187+181'
    + '&filter%5Blocation%5D%5Bsub_municipalities%5D=796+946+1386+1450+2536+2008+2019+2501+2543'
    + '&filter%5Bproperty_type%5D=46'
    + `&filter%5Bprice%5D=%28min%3A%3Bmax%3A${max}%29`;
  const html = await fetchText(url);
  const cards = extractCards(html, ERA_BASE);
  if (cards.length === 0) throw new Error('era: 0 annonces parsées (structure de page inconnue ?)');
  return cardsToListings(cards, { source: 'era', prefix: 'era', region, fourFacades, budget, requireZone: false });
}

// ── Main handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // GET (paramètres d'URL) accepté en plus de POST pour tester depuis un navigateur
  let params;
  if (req.method === 'POST') {
    params = req.body || {};
  } else if (req.method === 'GET') {
    const q = req.query || {};
    params = { ...q, fourFacades: q.fourFacades === '1' || q.fourFacades === 'true' };
  } else {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { region, budget, fourFacades } = params;
  const budgetNum = budget ? parseInt(budget, 10) : 0;
  const args = { region, budget: budgetNum, fourFacades };

  const fetchers = {
    immoweb: fetchImmoweb,
    honesty: fetchHonesty,
    wimmo: fetchWimmo,
    era: fetchEra,
  };
  const names = Object.keys(fetchers);
  const settled = await Promise.allSettled(names.map((n) => fetchers[n](args)));

  const lists = {};
  const errors = {};
  names.forEach((n, i) => {
    lists[n] = settled[i].status === 'fulfilled' ? settled[i].value : [];
    errors[n] = settled[i].status === 'rejected' ? settled[i].reason?.message : null;
  });

  const all = Object.values(lists).flat()
    .sort((a, b) => (a.daysAgo ?? 99) - (b.daysAgo ?? 99));

  return res.status(200).json({
    listings: all,
    total: all.length,
    sources: {
      immoweb: lists.immoweb.length,
      honesty: lists.honesty.length,
      wimmo: lists.wimmo.length,
      era: lists.era.length,
      errors,
    },
  });
};
