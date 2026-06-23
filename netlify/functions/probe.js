const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept': 'application/json, text/html, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

exports.handler = async () => {
  const results = {};

  // 1. Remax Luxembourg CMS (realestateplatform.com)
  const cmsBase = 'https://remaxluxembourg.prod.cms.realestateplatform.com';
  const cmsPaths = [
    '/api/v1/listings?transaction=buy&limit=5',
    '/api/listings?country=LU&limit=5',
    '/api/v1/properties?limit=5',
    '/api/v1/search?transaction=buy',
    '/api/properties?country=LU',
    '/uploads/shared-assets/',
  ];
  results.remax_cms = [];
  for (const path of cmsPaths) {
    try {
      const r = await fetch(cmsBase + path, { headers: HEADERS });
      const text = await r.text();
      results.remax_cms.push({ path, status: r.status, size: text.length, preview: text.substring(0, 200) });
    } catch(e) { results.remax_cms.push({ path, error: e.message.substring(0, 60) }); }
  }

  // 2. Try remax.lu main JS chunk (app bundle)
  try {
    // The chunks from runtime: e48814ae is likely the main app
    const r = await fetch('https://www.remax.lu/static/js/vendors-main~e48814ae.js', { headers: HEADERS });
    if (r.ok) {
      const js = await r.text();
      const apiUrls = [...js.matchAll(/["'](https?:\/\/[^"']*(?:api|remax)[^"']{0,80})["']/g)].map(m => m[1]).filter((v,i,a)=>a.indexOf(v)===i).slice(0,15);
      results.remax_app_chunk = { size: js.length, apiUrls };
    } else {
      // Try finding the right chunk hash from the buy page 404 response
      const r2 = await fetch('https://www.remax.lu/buy/', { headers: HEADERS });
      const html = await r2.text();
      const chunks = [...html.matchAll(/\/static\/js\/([^"']+\.js)/g)].map(m=>m[1]).slice(0,10);
      results.remax_app_chunk = { chunks_from_html: chunks };
    }
  } catch(e) { results.remax_app_chunk = { error: e.message }; }

  // 3. Try immotop.lu with a Googlebot user agent (they sometimes whitelist)
  try {
    const r = await fetch('https://www.immotop.lu/vente/maison/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }
    });
    const text = await r.text();
    results.immotop_googlebot = { status: r.status, size: text.length, hasPrice: text.includes('price') || text.includes('prix'), preview: text.substring(0, 300) };
  } catch(e) { results.immotop_googlebot = { error: e.message }; }

  // 4. Try ERA Luxembourg with Googlebot
  try {
    const r = await fetch('https://www.era.lu/fr/biens-a-vendre/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }
    });
    const text = await r.text();
    results.era_googlebot = { status: r.status, size: text.length, hasNext: text.includes('__NEXT_DATA__'), preview: text.substring(0, 300) };
  } catch(e) { results.era_googlebot = { error: e.message }; }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results, null, 2),
  };
};
