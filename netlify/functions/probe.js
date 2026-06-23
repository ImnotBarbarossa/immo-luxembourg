const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

exports.handler = async () => {
  const results = {};

  // 1. Analyze remax.lu JS bundle for API endpoints
  try {
    const mainJs = await fetch('https://www.remax.lu/static/js/vendors-main~cdd60c62.ade39ff9.js', { headers: HEADERS });
    const js = await mainJs.text();
    const apiPaths = [...js.matchAll(/["'](https?:\/\/[^"']+api[^"']{0,60})["']/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 15);
    const endpoints = [...js.matchAll(/["'](\/api\/[^"']{0,60})["']/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 15);
    results.remax_js = { size: js.length, apiPaths, endpoints };
  } catch(e) { results.remax_js = { error: e.message }; }

  // Also try the main chunk
  try {
    const r = await fetch('https://www.remax.lu/static/js/vendors-main~f82e0cd2.967ba1ac.js', { headers: HEADERS });
    const js = await r.text();
    const apiPaths = [...js.matchAll(/["'](https?:\/\/[^"']*remax[^"']{0,80})["']/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 10);
    results.remax_main_chunk = { size: js.length, remaxUrls: apiPaths };
  } catch(e) { results.remax_main_chunk = { error: e.message }; }

  // 2. Check belgoimmo.be for Luxembourg listings
  try {
    const r = await fetch('https://www.belgoimmo.be/luxembourg/acheter', { headers: HEADERS });
    const html = await r.text();
    const hasListings = html.includes('price') || html.includes('prix') || html.includes('surface');
    const links = [...html.matchAll(/href="([^"]+luxembourg[^"]+)"/g)].map(m => m[1]).slice(0, 10);
    results.belgoimmo = { status: r.status, size: html.length, hasListings, links, preview: html.substring(0, 500) };
  } catch(e) { results.belgoimmo = { error: e.message }; }

  // 3. Try century21.lu with different paths
  const c21urls = ['https://www.century21.lu/fr/acheter/', 'https://www.century21.lu/fr/annonces/', 'https://century21.lu/acheter/'];
  results.century21 = [];
  for (const url of c21urls) {
    try {
      const r = await fetch(url, { headers: HEADERS, redirect: 'follow' });
      const text = await r.text();
      results.century21.push({ url, status: r.status, size: text.length, preview: text.substring(0, 200) });
    } catch(e) { results.century21.push({ url, error: e.message }); }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results, null, 2),
  };
};
