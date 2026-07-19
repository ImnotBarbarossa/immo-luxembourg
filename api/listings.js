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
// Séparateurs [\s-] : fonctionne aussi sur les slugs d'URL ("maison-2-facades")
const NOT_DETACHED_RE = /(2|3|deux|trois)[\s-]*fa[çc]ades|mitoyen|jumel[ée]|semi-?detached|maison[\s-]de[\s-](ville|rang[ée]e)|row[\s-]?house|town[\s-]?house/i;

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

// ── Extraction Honesty (JSON Whise embarqué dans la page) ────────────────────
// Chaque bien est un objet JSON contenant "putOnlineDateTime". On remonte au
// '{' englobant (vérifié par JSON.parse) plutôt que de compter les crochets,
// car les textes des annonces contiennent des "[oui/non]" qui piègent un scan naïf.
function scanObjectEnd(text, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function extractWhiseEstates(html) {
  const estates = [];
  let idx = -1;
  while ((idx = html.indexOf('"putOnlineDateTime"', idx + 1)) !== -1) {
    let probe = idx;
    for (let t = 0; t < 300 && probe > 0; t++) {
      probe = html.lastIndexOf('{', probe - 1);
      if (probe === -1) break;
      const end = scanObjectEnd(html, probe);
      if (end > idx) {
        try {
          const obj = JSON.parse(html.slice(probe, end + 1));
          if (obj && typeof obj === 'object' && 'putOnlineDateTime' in obj) {
            estates.push(obj);
            idx = end;
            break;
          }
        } catch { /* '{' au milieu d'une chaîne : on continue à remonter */ }
      }
    }
  }
  return estates;
}

function daysAgoFrom(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - d) / 86400000));
}

const ZIP_TO_COMMUNE = {
  6700: 'Arlon', 6704: 'Guirsch', 6706: 'Autelbas', 6717: 'Attert',
  6720: 'Habay', 6721: 'Anlier', 6723: 'Habay-la-Vieille', 6724: 'Marbehan',
  6780: 'Messancy', 6781: 'Sélange', 6782: 'Habergy',
};

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

// ── Honesty (JSON Whise embarqué dans la page de recherche) ──────────────────
// La recherche par code postal rayonne sur les communes voisines ; le format
// d'URL doit être complet (orderByField, rooms, minprice…) sinon la page
// revient vide. Format calqué sur une recherche faite sur le site.
async function fetchHonesty({ region, budget, fourFacades }) {
  const zips = region && REGION_POSTALS[region]
    ? [REGION_POSTALS[region][0]]
    : ['6717', '6780'];
  // searchziplabel doit être au format "Commune (code postal)" sinon la page
  // revient vide (constaté par diagnostic : zip brut → 0 bien, label → OK)
  const makeUrl = (zip) => {
    const label = encodeURIComponent(`${ZIP_TO_COMMUNE[zip] || zip} (${zip})`);
    return `${HONESTY_BASE}/biens-a-vendre/?purpose=%5B1%2C3%5D&orderByField=Zip&orderSorting=ASC&displayStatusIdList=%5B2%5D&searchtxtinput=${label}&searchinput=${zip}&searchziplabel=${label}&category=1&rooms=0&minprice=&maxprice=${budget || 600000}&inputestateid=`;
  };

  const pages = await Promise.allSettled(zips.map((z) => fetchText(makeUrl(z))));
  const byId = new Map();
  let okPages = 0;
  for (const p of pages) {
    if (p.status !== 'fulfilled') continue;
    okPages++;
    for (const e of extractWhiseEstates(p.value)) {
      const key = e.id || e.referenceNumber;
      if (key && !byId.has(key)) byId.set(key, e);
    }
  }
  if (okPages === 0) throw new Error('honesty: aucune page accessible');
  const estates = [...byId.values()];

  let list = estates.filter((e) => ZONE_POSTALS.has(String(e.zip || '')));
  // Vente uniquement (purposeId 1 = vente chez Whise) et maisons si renseigné
  list = list.filter((e) => !e.purposeId || e.purposeId === 1 || e.purposeId === 3);
  if (region && REGION_POSTALS[region]) {
    const filtered = list.filter((e) => REGION_POSTALS[region].includes(String(e.zip)));
    if (filtered.length > 0) list = filtered;
  }
  if (fourFacades) {
    list = list.filter((e) =>
      !NOT_DETACHED_RE.test(`${e.name || ''} ${e.shortDescription?.content || ''}`));
  }
  if (budget) list = list.filter((e) => !e.price || e.price <= budget);

  return list.slice(0, 12).map((e) => {
    const daysAgo = daysAgoFrom(e.putOnlineDateTime);
    const city = e.city || ZIP_TO_COMMUNE[e.zip] || `CP ${e.zip}`;
    const pic = Array.isArray(e.pictures) && e.pictures[0]
      ? (e.pictures[0].urlLarge || e.pictures[0].urlSmall || null) : null;
    return {
      id: `hon-${e.id || e.referenceNumber}`,
      title: e.name && !/^\d/.test(e.name) ? e.name : `Maison à ${city}`,
      type: 'Maison',
      location: city,
      price: e.price || 0,
      surface: e.maxArea || e.minArea || 0,
      rooms: 0,
      bedrooms: e.rooms || 0,
      source: 'honesty',
      isNew: daysAgo != null && daysAgo <= 3,
      daysAgo,
      url: `${HONESTY_BASE}/biens-a-vendre/?inputestateid=${e.id || ''}`,
      image: pic,
    };
  });
}

// ── W Immobilière (JSON des biens dans #properties-locations-json) ───────────
async function fetchWimmo({ region, budget, fourFacades }) {
  const url = `${WIMMO_BASE}/rechercher/biens?SortFields=ID+DESC&Goal=0&WebIDs=1&PriceTo=${budget || 600000}`;
  const html = await fetchText(url);
  const divIdx = html.indexOf('properties-locations-json');
  if (divIdx === -1) throw new Error('wimmo: bloc de données introuvable');
  const arrStart = html.indexOf('[', divIdx);
  const arrEnd = html.indexOf(']</div>', arrStart);
  if (arrStart === -1 || arrEnd === -1) throw new Error('wimmo: JSON introuvable');
  const decoded = html.slice(arrStart, arrEnd + 1)
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
  const props = JSON.parse(decoded);

  const linkTxt = (p) => { try { return decodeURIComponent(p.link || '').toLowerCase(); } catch { return (p.link || '').toLowerCase(); } };
  // goal 0 = vente ; on ne garde que les maisons/villas de la zone
  let list = props.filter((p) => p.goal === 0 && /\/acheter\/(maison|villa)/.test(linkTxt(p)));
  list = list.filter((p) => ZONE_RE.test(linkTxt(p)));
  if (region && REGION_MATCH[region]) {
    const filtered = list.filter((p) => REGION_MATCH[region].test(linkTxt(p)));
    if (filtered.length > 0) list = filtered;
  }
  if (fourFacades) list = list.filter((p) => !NOT_DETACHED_RE.test(linkTxt(p)));
  if (budget) list = list.filter((p) => { const pr = parsePrice(p.title || ''); return !pr || pr <= budget; });

  return list.slice(0, 12).map((p) => {
    // linkTxt : ['https:', 'www.wimmobiliere.com', 'acheter', 'maison', commune, id, slug]
    const parts = linkTxt(p).split('/').filter(Boolean);
    const commune = parts[4] || 'arlon';
    const slug = (parts[6] || '').replace(/-/g, ' ');
    const title = slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : `Maison à ${commune}`;
    return {
      id: `wim-${p.id}`,
      title,
      type: 'Maison',
      location: commune.charAt(0).toUpperCase() + commune.slice(1),
      price: parsePrice(p.title || ''),
      surface: 0,
      rooms: 0,
      bedrooms: 0,
      source: 'wimmo',
      isNew: false,
      daysAgo: null,
      url: p.link,
      image: null,
    };
  });
}

// ── ERA (cartes Drupal rendues côté serveur ; lien via /fr/node/{nid}) ───────
async function fetchEra({ region, budget, fourFacades }) {
  const max = budget || 600000;
  const url = `${ERA_BASE}/fr/a-vendre?pager%5Blimit%5D=24&broker_id=6000144`
    + '&filter%5Blocation%5D%5Bmunicipalities%5D=187+181'
    + '&filter%5Blocation%5D%5Bsub_municipalities%5D=796+946+1386+1450+2536+2008+2019+2501+2543'
    + '&filter%5Bproperty_type%5D=46'
    + `&filter%5Bprice%5D=%28min%3A%3Bmax%3A${max}%29`;
  const html = await fetchText(url);

  const cardRe = /data-nid="(\d+)"[\s\S]{0,900}?property-teaser__content[\s\S]{0,400}?<h3>([^<]+)<\/h3>[\s\S]{0,300}?field--price">([^<]+)<[\s\S]{0,400}?field--address[^>]*>([^<]+)</g;
  const seen = new Set();
  const cards = [];
  let m;
  while ((m = cardRe.exec(html))) {
    const [, nid, title, priceTxt, address] = m;
    if (seen.has(nid)) continue;
    seen.add(nid);
    const after = html.slice(m.index, m.index + 2500);
    cards.push({
      nid,
      title: title.trim(),
      price: parsePrice(priceTxt),
      address: address.trim(),
      zip: (address.match(/\b(\d{4})\b/) || [])[1] || '',
      bedrooms: parseInt((after.match(/(\d{1,2})\s*chbre/) || [])[1] || '0', 10),
      surface: parseInt((after.match(/(\d{2,4})\s*m²\s*de surf/) || [])[1] || '0', 10),
    });
  }
  if (!cards.length) throw new Error('era: aucune carte parsée');

  // Les filtres GET d'era.be ne s'appliquent pas côté serveur : filtre zone strict
  let list = cards.filter((c) => ZONE_POSTALS.has(c.zip));
  if (region && REGION_POSTALS[region]) {
    const filtered = list.filter((c) => REGION_POSTALS[region].includes(c.zip));
    if (filtered.length > 0) list = filtered;
  }
  if (fourFacades) list = list.filter((c) => !NOT_DETACHED_RE.test(c.title));
  if (budget) list = list.filter((c) => !c.price || c.price <= budget);

  return list.slice(0, 12).map((c) => ({
    id: `era-${c.nid}`,
    title: c.title,
    type: 'Maison',
    location: c.address.replace(/^[^,]*,\s*/, ''),
    price: c.price,
    surface: c.surface,
    rooms: 0,
    bedrooms: c.bedrooms,
    source: 'era',
    isNew: false,
    daysAgo: null,
    url: `${ERA_BASE}/fr/node/${c.nid}`,
    image: null,
  }));
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
