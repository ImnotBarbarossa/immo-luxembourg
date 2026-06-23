const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

exports.handler = async () => {
  const results = {};

  // 1. Remax: find main app bundle via runtime.js chunk manifest
  try {
    const r = await fetch('https://www.remax.lu/static/js/runtime.a2753db5.js', { headers: HEADERS });
    const js = await r.text();
    // Chunk hashes are in the runtime manifest
    const chunks = [...js.matchAll(/["']([a-f0-9]{8})["']/g)].map(m => m[1]).slice(0, 10);
    results.remax_runtime = { size: js.length, chunks, preview: js.substring(0, 500) };
  } catch(e) { results.remax_runtime = { error: e.message }; }

  // 2. Remax: try their likely search API endpoints
  const remaxApis = [
    'https://www.remax.lu/api/v1/properties?transaction=buy&country=LU&size=5',
    'https://api.remax.lu/properties?transaction=buy&country=LU',
    'https://www.remax.lu/api/search?transaction=buy&q=Luxembourg',
    'https://www.remax.lu/api/properties/search?country=LU&buy=true',
  ];
  results.remax_apis = [];
  for (const url of remaxApis) {
    try {
      const r = await fetch(url, { headers: { ...HEADERS, Accept: 'application/json' }, redirect: 'follow' });
      const text = await r.text();
      results.remax_apis.push({ url, status: r.status, size: text.length, preview: text.substring(0, 200) });
    } catch(e) { results.remax_apis.push({ url, error: e.message }); }
  }

  // 3. Century21.lu: check if Next.js with __NEXT_DATA__
  try {
    const r = await fetch('https://www.century21.lu/fr/acheter/', { headers: HEADERS });
    const html = await r.text();
    const nextDataIdx = html.indexOf('__NEXT_DATA__');
    const hasNext = nextDataIdx >= 0;
    const nextPreview = hasNext ? html.substring(nextDataIdx, nextDataIdx + 500) : '';
    // Try _next/data endpoint
    const buildIdMatch = html.match(/"buildId"\s*:\s*"([^"]+)"/);
    const buildId = buildIdMatch ? buildIdMatch[1] : null;
    results.century21 = { status: r.status, size: html.length, hasNext, buildId, nextPreview };
  } catch(e) { results.century21 = { error: e.message }; }

  // 4. Try wort.lu immo with different URL
  const wortUrls = [
    'https://immo.wort.lu/fr/annonces/vente',
    'https://www.wort.lu/immobilier/vente',
    'https://immo.wort.lu/api/listings?type=vente',
  ];
  results.wort = [];
  for (const url of wortUrls) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      const text = await r.text();
      results.wort.push({ url, status: r.status, size: text.length, preview: text.substring(0, 200) });
    } catch(e) { results.wort.push({ url, error: e.message.substring(0, 60) }); }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results, null, 2),
  };
};
