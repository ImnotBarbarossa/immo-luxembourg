const ATHOME_BASE = 'https://www.athome.lu';

const TYPE_MAP = {
  Maison: 'HOUSE', Appartement: 'APARTMENT', Villa: 'HOUSE', Terrain: 'LAND',
};

const PROPERTY_TYPE_LABEL = {
  h: 'Maison', a: 'Appartement', r: 'Projet neuf', l: 'Terrain', v: 'Villa',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const { type, region, budget } = JSON.parse(event.body || '{}');

  // Build athome.lu search URL
  const params = new URLSearchParams({ tr: 'buy', q: region || 'Luxembourg', lang: 'fr' });
  if (budget) params.set('pmax', String(budget));
  const typeParam = type ? TYPE_MAP[type] : null;
  if (typeParam) params.set('idtype[]', typeParam === 'HOUSE' ? '2' : typeParam === 'APARTMENT' ? '1' : typeParam === 'LAND' ? '4' : '');

  const searchUrl = `${ATHOME_BASE}/srp/?${params}`;

  try {
    const resp = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
    });

    const html = await resp.text();

    // Extract __INITIAL_STATE__
    const stateStart = html.indexOf('window.__INITIAL_STATE__=');
    if (stateStart === -1) throw new Error('Could not find __INITIAL_STATE__');
    const stateEnd = html.indexOf('</script>', stateStart);
    // Trim trailing ; and whitespace before </script>
    let stateJson = html.substring(stateStart + 25, stateEnd).trimEnd();
    if (stateJson.endsWith(';')) stateJson = stateJson.slice(0, -1);

    // Parse JSON — replace undefined values injected by SSR
    const cleaned = stateJson.replace(/:undefined(?=[,}\]])/g, ':null');
    const state = JSON.parse(cleaned);

    const list = state?.search?.list || [];

    const listings = list.slice(0, 16).map((item) => {
      const permalink = item.meta?.permalink?.fr || '';
      const price = item.price || item.price_min || 0;
      const propType = PROPERTY_TYPE_LABEL[item.propertyType] || item.propertySubType || 'Bien';
      const source = 'athome';
      const daysAgo = item.publishedAt
        ? Math.max(0, Math.round((Date.now() - new Date(item.publishedAt)) / 86400000))
        : Math.floor(Math.random() * 14);

      return {
        id: String(item.id),
        title: item.title || `${propType} - ${item.city || 'Luxembourg'}`,
        type: propType,
        location: item.city || region || 'Luxembourg',
        price,
        surface: item.surface || 0,
        rooms: item.rooms || 0,
        bedrooms: item.bedrooms || 0,
        source,
        isNew: daysAgo <= 3,
        daysAgo,
        url: permalink ? `${ATHOME_BASE}/fr${permalink}` : searchUrl,
        image: item.media?.items?.[0]?.uri
          ? `https://i1.static.athome.eu/images/annonces2/image_/${item.media.items[0].uri.replace(/^\//, '')}`
          : null,
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listings, total: state?.search?.total || list.length, source: searchUrl }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
