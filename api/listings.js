const ATHOME_BASE = 'https://www.athome.lu';
const IMMOWEB_BASE = 'https://www.immoweb.be';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

const ATHOME_TYPE_MAP = { Maison: '2', Villa: '2', Appartement: '1', Terrain: '4' };
const ATHOME_TYPE_LABEL = { h: 'Maison', a: 'Appartement', r: 'Projet neuf', l: 'Terrain', v: 'Villa' };

function timeout(ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

async function fetchAthome({ type, region, budget }) {
  const params = new URLSearchParams({ tr: 'buy', q: region || 'Luxembourg', lang: 'fr' });
  if (budget) params.set('pmax', String(budget));
  const typeId = type ? ATHOME_TYPE_MAP[type] : null;
  if (typeId) params.set('idtype[]', typeId);

  const url = `${ATHOME_BASE}/srp/?${params}`;
  const { signal, clear } = timeout(7000);
  try {
    const resp = await fetch(url, { signal, headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'fr-FR,fr;q=0.9' } });
    const html = await resp.text();
    clear();

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
        title: item.title || `${ATHOME_TYPE_LABEL[item.propertyType] || 'Bien'} - ${item.city || 'Luxembourg'}`,
        type: ATHOME_TYPE_LABEL[item.propertyType] || 'Bien',
        location: item.city || region || 'Luxembourg',
        price: item.price || item.price_min || 0,
        surface: item.surface || 0,
        rooms: item.rooms || 0,
        bedrooms: item.bedrooms || 0,
        source: 'athome',
        isNew: daysAgo <= 3,
        daysAgo,
        url: permalink ? `${ATHOME_BASE}/fr${permalink}` : `${ATHOME_BASE}/srp/?tr=buy&q=${encodeURIComponent(region || 'Luxembourg')}`,
        image: item.media?.items?.[0]?.uri
          ? `https://i1.static.athome.eu/images/annonces2/image_/${item.media.items[0].uri.replace(/^\//, '')}`
          : null,
      };
    });
  } catch (e) {
    clear();
    throw e;
  }
}

async function fetchImmoweb({ type, region, budget }) {
  const propType = type === 'Appartement' ? 'APARTMENT' : type === 'Terrain' ? 'LAND' : 'HOUSE';
  // Fetch more results so client-side locality filter has enough candidates
  const apiUrl = `${IMMOWEB_BASE}/fr/search-results?countries=LU&transactionTypes=FOR_SALE&propertyTypes=${propType}&orderBy=newest&size=30&page=1`;

  const { signal, clear } = timeout(7000);
  try {
    const resp = await fetch(apiUrl, {
      signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, */*; q=0.01',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Referer': `${IMMOWEB_BASE}/fr/recherche/maison/a-vendre/luxembourg`,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    const data = await resp.json();
    clear();

    let results = data.results || [];

    // Client-side locality filter: immoweb API doesn't support commune filtering
    if (region) {
      const regionNorm = region.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const filtered = results.filter((item) => {
        const loc = (item.property?.location?.locality || '').toLowerCase()
          .normalize('NFD').replace(/[̀-ͯ]/g, '');
        return loc.includes(regionNorm) || regionNorm.includes(loc);
      });
      // Only apply filter if it returns results; otherwise keep all (user searched a district/canton)
      if (filtered.length > 0) results = filtered;
    }

    return results.slice(0, 12).map((item) => {
      const prop = item.property || {};
      const price = item.price?.mainValue || item.transaction?.sale?.price || 0;
      const pubDate = item.publication?.lastModificationDate;
      const daysAgo = pubDate
        ? Math.max(0, Math.round((Date.now() - new Date(pubDate)) / 86400000))
        : 99;
      if (budget && price && price > budget) return null;

      const city = prop.location?.locality || 'Luxembourg';
      const typeLabel = prop.type === 'APARTMENT' ? 'Appartement' : prop.type === 'LAND' ? 'Terrain' : 'Maison';

      return {
        id: `iw-${item.id}`,
        title: prop.title || `${typeLabel} - ${city}`,
        type: typeLabel,
        location: city,
        price,
        surface: prop.netHabitableSurface || prop.landSurface || 0,
        rooms: prop.roomCount || 0,
        bedrooms: prop.bedroomCount || 0,
        source: 'immoweb',
        isNew: daysAgo <= 3,
        daysAgo,
        url: `${IMMOWEB_BASE}/fr/annonce/${item.id}`,
        image: item.media?.pictures?.[0]?.mediumUrl || item.media?.pictures?.[0]?.smallUrl || null,
      };
    }).filter(Boolean);
  } catch (e) {
    clear();
    throw e;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { type, region, budget } = req.body || {};

  const [athome, immoweb] = await Promise.allSettled([
    fetchAthome({ type, region, budget }),
    fetchImmoweb({ type, region, budget }),
  ]);

  const athomeList = athome.status === 'fulfilled' ? athome.value : [];
  const immowebList = immoweb.status === 'fulfilled' ? immoweb.value : [];

  const all = [...athomeList, ...immowebList]
    .sort((a, b) => (a.daysAgo || 99) - (b.daysAgo || 99));

  return res.status(200).json({
    listings: all,
    total: all.length,
    sources: {
      athome: athomeList.length,
      immoweb: immowebList.length,
      errors: {
        athome: athome.status === 'rejected' ? athome.reason?.message : null,
        immoweb: immoweb.status === 'rejected' ? immoweb.reason?.message : null,
      },
    },
  });
};
