const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

const MORE_SITES = [
  { name: 'remax_detail',   url: 'https://www.remax.lu/buy/' },
  { name: 'century21',      url: 'https://www.century21.lu/acheter/' },
  { name: 'property.lu',    url: 'https://www.property.lu/en/buy' },
  { name: 'luxresidence',   url: 'https://www.luxresidence.lu/en/buy' },
  { name: 'atoffice',       url: 'https://www.atoffice.lu/vente/' },
  { name: 'belgoimmo',      url: 'https://www.belgoimmo.be/luxembourg/acheter' },
  { name: 'zimmo',          url: 'https://www.zimmo.lu/fr/maisons-a-vendre/' },
  { name: 'immo365',        url: 'https://www.immo365.lu/vente' },
  { name: 'remax_api',      url: 'https://www.remax.lu/api/properties?transaction=buy&country=lu&limit=5' },
  { name: 'remax_api2',     url: 'https://www.remax.lu/api/listings?type=buy&limit=5' },
  { name: 'remax_graphql',  url: 'https://www.remax.lu/graphql' },
];

exports.handler = async () => {
  // First get the full remax.lu HTML to analyze
  let remaxContent = '';
  try {
    const r = await fetch('https://www.remax.lu/buy/', { headers: HEADERS });
    remaxContent = await r.text();
  } catch(e) {}

  const remaxScripts = [...remaxContent.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]).slice(0, 5);
  const remaxApiHints = [...remaxContent.matchAll(/["'](\/api\/[^"']+)["']/g)].map(m => m[1]).slice(0, 10);
  const remaxEnv = remaxContent.includes('__NEXT_DATA__') ? 'Next.js'
    : remaxContent.includes('__NUXT__') ? 'Nuxt'
    : remaxContent.includes('window.__') ? 'SPA/custom'
    : 'unknown';

  const results = await Promise.all(MORE_SITES.map(async (site) => {
    try {
      const r = await fetch(site.url, { headers: HEADERS, redirect: 'follow' });
      const text = await r.text();
      return { name: site.name, status: r.status, size: text.length, preview: text.substring(0, 300) };
    } catch (e) {
      return { name: site.name, error: e.message };
    }
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remaxEnv, remaxScripts, remaxApiHints, remaxSize: remaxContent.length, sites: results }, null, 2),
  };
};
