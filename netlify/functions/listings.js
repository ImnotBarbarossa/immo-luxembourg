exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { type, region, budget } = JSON.parse(event.body || '{}');

  // Mapping types -> athome.lu property types
  const typeMap = { Maison: 'HOUSE', Appartement: 'APARTMENT', Villa: 'HOUSE', Terrain: 'LAND' };
  const propertyType = typeMap[type];

  const query = {
    where: [{ locality: region || 'Luxembourg' }],
    filters: {
      'transaction.type': 'buy',
      'price': { gte: '50000', ...(budget ? { lte: String(budget) } : {}) },
      ...(propertyType ? { 'property.type': propertyType } : {}),
    },
    modifiers: { with_child: true, apply_to_child: true, with_characteristic: true, with_agencies: false },
    seo: [],
  };

  const apiBody = {
    site: 'lu_at_home',
    page: 1,
    size: 16,
    sort: [],
    fgroup: 'srp',
    query: [query],
    aggregate: [],
  };

  try {
    const resp = await fetch('https://www.athome.lu/portal-srp/api/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'keep-alive',
        'User-Agent': 'Mozilla/5.0 (compatible; Netlify Function)',
        'Origin': 'https://www.athome.lu',
        'Referer': 'https://www.athome.lu/srp/?tr=buy&q=Luxembourg',
        'Accept': 'application/json',
      },
      body: JSON.stringify(apiBody),
    });

    const raw = await resp.text();

    // Return both the raw response and status for debugging
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: resp.status, raw: raw.substring(0, 5000) }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
