const ATHOME_BASE = 'https://www.athome.lu';
const IMMOWEB_BASE = 'https://www.immoweb.be';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

const ATHOME_TYPE_MAP = { Maison: '2', Villa: '2', Appartement: '1', Terrain: '4' };
const ATHOME_TYPE_LABEL = { h: 'Maison', a: 'Appartement', r: 'Projet neuf', l: 'Terrain', v: 'Villa' };

// Arrondissement d'Arlon (province de Luxembourg, frontière luxembourgeoise)
const REGION_POSTALS = {
  arlon: ['6700', '6704', '6706'],
  attert: ['6717'],
  messancy: ['6780', '6781', '6782'],
  aubange: ['6790', '6791', '6792'],
  martelange: ['6630'],
};
const DISTRICT_POSTALS = new Set(Object.values(REGION_POSTALS).flat());

// Le frontend envoie les types en minuscules ("maison"), on normalise ici
function normType(type) {
  const t = (type || '').toLowerCase();
  return { maison: 'Maison', appartement: 'Appartement', villa: 'Villa', terrain: 'Terrain' }[t] || '';
}

function timeout(ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

async function fetchAthome({ type, region, budget, fourFacades }) {
  // athome.lu référence aussi les biens belges frontaliers (ciblés frontaliers)
  const q = region ? region.charAt(0).toUpperCase() + region.slice(1) : 'Arlon';
  const params = new URLSearchParams({ tr: 'buy', q, lang: 'fr' });
  if (budget) params.set('pmax', String(budget));
  const t = normType(type);
  const typeId = t ? ATHOME_TYPE_MAP[t] : null;
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
    let list = state?.search?.list || [];

    if (fourFacades) {
      const detached = list.filter((item) =>
        /4\s*fa[çc]ades|villa/i.test(`${item.title || ''} ${item.propertySubType || ''}`)
        || item.propertyType === 'v');
      // Si la donnée ne permet pas de trancher, on garde tout plutôt que de tout masquer
      if (detached.length > 0) list = detached;
    }

    return list.slice(0, 12).map((item) => {
      const permalink = item.meta?.permalink?.fr || '';
      const daysAgo = item.publishedAt
        ? Math.max(0, Math.round((Date.now() - new Date(item.publishedAt)) / 86400000))
        : 99;
      return {
        id: `ath-${item.id}`,
        title: item.title || `${ATHOME_TYPE_LABEL[item.propertyType] || 'Bien'} - ${item.city || q}`,
        type: ATHOME_TYPE_LABEL[item.propertyType] || 'Bien',
        location: item.city || q,
        price: item.price || item.price_min || 0,
        surface: item.surface || 0,
        rooms: item.rooms || 0,
        bedrooms: item.bedrooms || 0,
        source: 'athome',
        isNew: daysAgo <= 3,
        daysAgo,
        url: permalink ? `${ATHOME_BASE}/fr${permalink}` : `${ATHOME_BASE}/srp/?tr=buy&q=${encodeURIComponent(q)}`,
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

async function fetchImmoweb({ type, region, budget, fourFacades }) {
  const t = normType(type);
  const propType = t === 'Appartement' ? 'APARTMENT' : t === 'Terrain' ? 'LAND' : 'HOUSE';
  // districts=ARLON limite à l'arrondissement d'Arlon ; size=30 pour laisser
  // de la marge aux filtres client (commune, 4 façades, budget)
  const apiUrl = `${IMMOWEB_BASE}/fr/search-results?countries=BE&districts=ARLON&transactionTypes=FOR_SALE&propertyTypes=${propType}&orderBy=newest&size=30&page=1`;

  const { signal, clear } = timeout(7000);
  try {
    const resp = await fetch(apiUrl, {
      signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, */*; q=0.01',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Referer': `${IMMOWEB_BASE}/fr/recherche/maison/a-vendre/arlon/6700`,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    const data = await resp.json();
    clear();

    let results = data.results || [];

    // Garde-fou : si l'API ignore districts=ARLON, on écarte tout bien hors
    // arrondissement (code postal connu). Les biens sans code postal sont gardés.
    results = results.filter((item) => {
      const zip = String(item.property?.location?.postalCode || '');
      return !zip || DISTRICT_POSTALS.has(zip);
    });

    // Filtre commune par code postal (plus fiable que le nom de localité)
    if (region && REGION_POSTALS[region]) {
      const zips = REGION_POSTALS[region];
      const filtered = results.filter((item) =>
        zips.includes(String(item.property?.location?.postalCode || '')));
      // Aucune annonce dans la commune → on montre tout l'arrondissement
      if (filtered.length > 0) results = filtered;
    }

    if (fourFacades) {
      const detached = results.filter((item) => {
        const subtype = (item.property?.subtype || '').toUpperCase();
        const facades = item.property?.building?.facadeCount;
        return subtype === 'VILLA' || (facades && facades >= 4);
      });
      // Si la donnée ne permet pas de trancher, on garde tout plutôt que de tout masquer
      if (detached.length > 0) results = detached;
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
        : 99;

      const city = prop.location?.locality || 'Arlon';
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
    });
  } catch (e) {
    clear();
    throw e;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { type, region, budget, fourFacades } = req.body || {};
  const budgetNum = budget ? parseInt(budget, 10) : 0;

  const [athome, immoweb] = await Promise.allSettled([
    fetchAthome({ type, region, budget: budgetNum, fourFacades }),
    fetchImmoweb({ type, region, budget: budgetNum, fourFacades }),
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
