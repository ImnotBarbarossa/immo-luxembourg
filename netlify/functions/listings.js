const ATHOME_BASE = 'https://www.athome.lu';
const IMMOWEB_BASE = 'https://www.immoweb.be';
const WORT_BASE = 'https://immo.wort.lu';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

const ATHOME_TYPE_MAP = { Maison: '2', Villa: '2', Appartement: '1', Terrain: '4' };
const ATHOME_TYPE_LABEL = { h: 'Maison', a: 'Appartement', r: 'Projet neuf', l: 'Terrain', v: 'Villa' };

// ── athome.lu ────────────────────────────────────────────────────────────────
async function fetchAthome({ type, region, budget }) {
  const params = new URLSearchParams({ tr: 'buy', q: region || 'Luxembourg', lang: 'fr' });
  if (budget) params.set('pmax', String(budget));
  const typeId = type ? ATHOME_TYPE_MAP[type] : null;
  if (typeId) params.set('idtype[]', typeId);

  const url = `${ATHOME_BASE}/srp/?${params}`;
  const resp = await fetch(url, { headers: HEADERS });
  const html = await resp.text();

  const stateStart = html.indexOf('window.__INITIAL_STATE__=');
  if (stateStart === -1) throw new Error('athome: no __INITIAL_STATE__');
  const stateEnd = html.indexOf('</script>', stateStart);
  let stateJson = html.substring(stateStart + 25, stateEnd).trimEnd();
  if (stateJson.endsWith(';')) stateJson = stateJson.slice(0, -1);
  const state = JSON.parse(stateJson.replace(/:undefined(?=[,}\]])/g, ':null'));
  const list = state?.search?.list || [];

  return list.slice(0, 12).map((item) => {
    const permalink = item.meta?.permalink?.fr || '';
    const daysAgo = item.publishedAt
      ? Math.max(0, Math.round((Date.now() - new Date(item.publishedAt)) / 86400000))
      : 99;
    return {
      id: `ath-${item.id}`,
      title: item.title || `${ATHOME_TYPE_LABEL[item.propertyType] || 'Bien'} - ${item.city || region || 'Luxembourg'}`,
      type: ATHOME_TYPE_LABEL[item.propertyType] || item.propertySubType || 'Bien',
      location: item.city || region || 'Luxembourg',
      price: item.price || item.price_min || 0,
      surface: item.surface || 0,
      rooms: item.rooms || 0,
      bedrooms: item.bedrooms || 0,
      source: 'athome',
      isNew: daysAgo <= 3,
      daysAgo,
      url: permalink ? `${ATHOME_BASE}/fr${permalink}` : url,
      image: item.media?.items?.[0]?.uri
        ? `https://i1.static.athome.eu/images/annonces2/image_/${item.media.items[0].uri.replace(/^\//, '')}`
        : null,
    };
  });
}

// ── immoweb.be (Luxembourg) ──────────────────────────────────────────────────
async function fetchImmoweb({ type, budget }) {
  const typeParam = type === 'Appartement' ? 'appartement' : type === 'Terrain' ? 'terrain' : 'maison';
  const url = `${IMMOWEB_BASE}/fr/recherche/${typeParam}/a-vendre/luxembourg?orderBy=newest`;
  const resp = await fetch(url, { headers: HEADERS });
  const html = await resp.text();

  // Extract window.search = { ... }
  const marker = 'window.search = ';
  const idx = html.indexOf(marker);
  if (idx === -1) return [];
  const start = idx + marker.length;
  let depth = 0, i = start;
  while (i < html.length && i < start + 500000) {
    const c = html[i];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth <= 0) { i++; break; } }
    else if (depth === 0 && (c === ';' || c === '\n')) break;
    i++;
  }
  let raw = html.substring(start, i).trim();
  if (raw.endsWith(';')) raw = raw.slice(0, -1);

  let search;
  try { search = JSON.parse(raw); } catch { return []; }

  const classifieds = search?.classifieds || search?.results || [];
  return classifieds.slice(0, 12).filter(c => c).map((c) => {
    const prop = c.property || c;
    const price = prop.price?.mainValue || prop.price || 0;
    const publishedAt = c.publishedAt || c.lastModificationDate;
    const daysAgo = publishedAt
      ? Math.max(0, Math.round((Date.now() - new Date(publishedAt)) / 86400000))
      : 99;
    const id = c.id || c.classified?.id || Math.random();
    const city = prop.location?.locality || prop.locality || 'Luxembourg';
    const surface = prop.netHabitableSurface || prop.totalSurface || prop.landSurface || 0;
    const rooms = prop.roomCount || 0;
    const bedrooms = prop.bedroomCount || 0;
    const typeLabel = prop.type === 'APARTMENT' ? 'Appartement' : prop.type === 'LAND' ? 'Terrain' : 'Maison';
    const slug = c.id ? `/${c.id}` : '';
    const photo = (prop.photos || prop.images || [])[0];
    const imgUrl = photo?.url || photo?.uri || (typeof photo === 'string' ? photo : null);
    const budgetOk = !budget || !price || price <= budget;
    if (!budgetOk) return null;
    return {
      id: `iw-${id}`,
      title: c.description || `${typeLabel} - ${city}`,
      type: typeLabel,
      location: city,
      price,
      surface,
      rooms,
      bedrooms,
      source: 'immoweb',
      isNew: daysAgo <= 3,
      daysAgo,
      url: slug ? `${IMMOWEB_BASE}/fr/annonce${slug}` : url,
      image: imgUrl || null,
    };
  }).filter(Boolean);
}

// ── immo.wort.lu ─────────────────────────────────────────────────────────────
async function fetchWort({ type, region, budget }) {
  const typeSlug = type === 'Appartement' ? 'appartement' : type === 'Terrain' ? 'terrain' : 'maison';
  const url = `${WORT_BASE}/fr/annonces/${typeSlug}/vente?location=${encodeURIComponent(region || 'Luxembourg')}`;
  const resp = await fetch(url, { headers: HEADERS });
  const html = await resp.text();

  // Try __NEXT_DATA__
  const nextIdx = html.indexOf('id="__NEXT_DATA__"');
  if (nextIdx === -1) return [];
  const start = html.indexOf('>', nextIdx) + 1;
  const end = html.indexOf('</script>', start);
  let nextData;
  try { nextData = JSON.parse(html.substring(start, end)); } catch { return []; }

  const items =
    nextData?.props?.pageProps?.listings ||
    nextData?.props?.pageProps?.data?.listings ||
    nextData?.props?.pageProps?.results ||
    [];
  return items.slice(0, 8).map((item) => {
    const price = item.price || item.priceSale || 0;
    const daysAgo = item.publishedAt
      ? Math.max(0, Math.round((Date.now() - new Date(item.publishedAt)) / 86400000))
      : 99;
    if (budget && price && price > budget) return null;
    return {
      id: `wort-${item.id || Math.random()}`,
      title: item.title || `${typeSlug} - Luxembourg`,
      type: type || 'Maison',
      location: item.city || item.location || 'Luxembourg',
      price,
      surface: item.surface || item.area || 0,
      rooms: item.rooms || 0,
      bedrooms: item.bedrooms || 0,
      source: 'wort',
      isNew: daysAgo <= 3,
      daysAgo,
      url: item.url ? `${WORT_BASE}${item.url}` : url,
      image: item.image || item.thumbnail || null,
    };
  }).filter(Boolean);
}

// ── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const { type, region, budget } = JSON.parse(event.body || '{}');

  // Run all sources in parallel; tolerate individual failures
  const [athome, immoweb, wort] = await Promise.allSettled([
    fetchAthome({ type, region, budget }),
    fetchImmoweb({ type, budget }),
    fetchWort({ type, region, budget }),
  ]);

  const athomeList = athome.status === 'fulfilled' ? athome.value : [];
  const immoweb_list = immoweb.status === 'fulfilled' ? immoweb.value : [];
  const wortList = wort.status === 'fulfilled' ? wort.value : [];

  // Merge and sort by most recent
  const all = [...athomeList, ...immoweb_list, ...wortList]
    .sort((a, b) => (a.daysAgo || 99) - (b.daysAgo || 99));

  const sources = {
    athome: athomeList.length,
    immoweb: immoweb_list.length,
    wort: wortList.length,
    errors: {
      athome: athome.status === 'rejected' ? athome.reason?.message : null,
      immoweb: immoweb.status === 'rejected' ? immoweb.reason?.message : null,
      wort: wort.status === 'rejected' ? wort.reason?.message : null,
    },
  };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listings: all, total: all.length, sources }),
  };
};
