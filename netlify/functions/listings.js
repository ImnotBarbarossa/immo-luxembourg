const ATHOME_BASE = 'https://www.athome.lu';
const IMMOWEB_BASE = 'https://www.immoweb.be';

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

// ── immoweb.be (Luxembourg) via JSON search-results API ──────────────────────
async function fetchImmoweb({ type, budget }) {
  const propType = type === 'Appartement' ? 'APARTMENT' : type === 'Terrain' ? 'LAND' : 'HOUSE';
  const apiUrl = `${IMMOWEB_BASE}/fr/search-results?countries=LU&transactionTypes=FOR_SALE&propertyTypes=${propType}&orderBy=newest&size=20&page=1`;

  const resp = await fetch(apiUrl, {
    headers: {
      'User-Agent': HEADERS['User-Agent'],
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'fr-FR,fr;q=0.9',
      'Referer': `${IMMOWEB_BASE}/fr/recherche/maison/a-vendre/luxembourg`,
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  const data = await resp.json();
  const results = data.results || [];

  return results.slice(0, 12).map((item) => {
    const prop = item.property || {};
    const price = item.price?.mainValue || item.transaction?.sale?.price || 0;
    const pubDate = item.publication?.lastModificationDate;
    const daysAgo = pubDate
      ? Math.max(0, Math.round((Date.now() - new Date(pubDate)) / 86400000))
      : 99;
    if (budget && price && price > budget) return null;

    const city = prop.location?.locality || 'Luxembourg';
    const surface = prop.netHabitableSurface || prop.landSurface || 0;
    const typeLabel = prop.type === 'APARTMENT' ? 'Appartement' : prop.type === 'LAND' ? 'Terrain' : 'Maison';
    const typeSlugFr = prop.type === 'APARTMENT' ? 'appartement' : prop.type === 'LAND' ? 'terrain' : 'maison';
    const imgUrl = item.media?.pictures?.[0]?.mediumUrl || item.media?.pictures?.[0]?.smallUrl || null;

    // Build URL slug without accents
    const zip = prop.location?.postalCode || '';
    const slug = city
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const listingUrl = item.id
      ? `${IMMOWEB_BASE}/fr/annonce/${typeSlugFr}/${slug}/${zip}/${item.id}`
      : apiUrl;

    return {
      id: `iw-${item.id}`,
      title: prop.title || `${typeLabel} - ${city}`,
      type: typeLabel,
      location: city,
      price,
      surface,
      rooms: prop.roomCount || 0,
      bedrooms: prop.bedroomCount || 0,
      source: 'immoweb',
      isNew: daysAgo <= 3,
      daysAgo,
      url: listingUrl,
      image: imgUrl,
    };
  }).filter(Boolean);
}

// ── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const { type, region, budget } = JSON.parse(event.body || '{}');

  const [athome, immoweb] = await Promise.allSettled([
    fetchAthome({ type, region, budget }),
    fetchImmoweb({ type, budget }),
  ]);

  const athomeList = athome.status === 'fulfilled' ? athome.value : [];
  const immoweb_list = immoweb.status === 'fulfilled' ? immoweb.value : [];

  const all = [...athomeList, ...immoweb_list]
    .sort((a, b) => (a.daysAgo || 99) - (b.daysAgo || 99));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      listings: all,
      total: all.length,
      sources: {
        athome: athomeList.length,
        immoweb: immoweb_list.length,
        v: 'v4-immoweb-json',
        errors: {
          athome: athome.status === 'rejected' ? athome.reason?.message : null,
          immoweb: immoweb.status === 'rejected' ? immoweb.reason?.message : null,
        },
      },
    }),
  };
};
