const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

exports.handler = async () => {
  const results = {};

  // 1. Deep-dive immoweb.be Luxembourg
  try {
    const r = await fetch('https://www.immoweb.be/fr/recherche/maison/a-vendre/luxembourg', { headers: HEADERS });
    const html = await r.text();

    const hasInitial = html.includes('__INITIAL_STATE__');
    const hasNext = html.includes('__NEXT_DATA__');
    const hasNuxt = html.includes('__NUXT__');

    // Find embedded JSON keys
    const jsonBlocks = [...html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]{0,500})<\/script>/g)].map(m => m[1].substring(0, 200));
    const scriptVars = [...html.matchAll(/window\.(\w+)\s*=/g)].map(m => m[1]).slice(0, 20);

    // Look for listing data patterns
    const priceMatches = [...html.matchAll(/"price"\s*:\s*\{[^}]{0,100}\}/g)].slice(0, 3).map(m => m[0]);
    const idMatches = [...html.matchAll(/"id"\s*:\s*(\d{6,})/g)].map(m => m[1]).slice(0, 5);

    // Find API URLs
    const apiUrls = [...html.matchAll(/["'](https:\/\/[^"']*immoweb[^"']{0,80})["']/g)].map(m => m[1]).filter((v,i,a) => a.indexOf(v) === i).slice(0, 10);

    results.immoweb = {
      status: r.status, size: html.length,
      hasInitial, hasNext, hasNuxt,
      scriptVars, jsonBlocks: jsonBlocks.slice(0, 3),
      priceMatches, idMatches, apiUrls,
      preview: html.substring(0, 500),
    };
  } catch(e) { results.immoweb = { error: e.message }; }

  // 2. Try immoweb search API directly
  const immowebApis = [
    'https://www.immoweb.be/fr/recherche/maison/a-vendre/luxembourg?orderBy=newest',
    'https://api.immoweb.be/classifieds/search?countries=LU&transactionTypes=FOR_SALE&size=5',
    'https://www.immoweb.be/api/classifieds/search?countries=LU&transactionTypes=FOR_SALE',
  ];
  results.immoweb_apis = [];
  for (const url of immowebApis) {
    try {
      const r = await fetch(url, { headers: { ...HEADERS, Accept: 'application/json' } });
      const text = await r.text();
      results.immoweb_apis.push({ url, status: r.status, size: text.length, preview: text.substring(0, 300) });
    } catch(e) { results.immoweb_apis.push({ url, error: e.message.substring(0, 60) }); }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results, null, 2),
  };
};
