const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

exports.handler = async () => {
  const results = {};

  // Fetch immoweb page
  const r = await fetch('https://www.immoweb.be/fr/recherche/maison/a-vendre/luxembourg?orderBy=newest', { headers: HEADERS });
  const html = await r.text();

  // Extract all window.xxx = {...} assignments
  const windowVars = {};
  for (const varName of ['search', 'urls', 'iwb', 'translations', 'locale']) {
    const regex = new RegExp(`window\\.${varName}\\s*=\\s*`);
    const idx = html.search(regex);
    if (idx >= 0) {
      const start = html.indexOf('=', idx) + 1;
      // Find the end of the assignment (matching braces/brackets or end of statement)
      let depth = 0, i = start;
      while (i < html.length && i < start + 100000) {
        const c = html[i];
        if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') { depth--; if (depth <= 0) { i++; break; } }
        else if (depth === 0 && c === ';') break;
        i++;
      }
      const raw = html.substring(start, i).trim();
      try { windowVars[varName] = JSON.parse(raw.endsWith(';') ? raw.slice(0,-1) : raw); }
      catch { windowVars[varName] = raw.substring(0, 500); }
    }
  }

  // Extract from window.search: listing count and API info
  const search = windowVars.search || {};
  const urls = windowVars.urls || {};

  results.windowSearch = typeof search === 'object' ? {
    keys: Object.keys(search).slice(0, 20),
    totalCount: search.totalCount,
    classifieds: Array.isArray(search.classifieds) ? search.classifieds.slice(0, 2) : 'not array',
    results: Array.isArray(search.results) ? search.results.slice(0, 2) : 'not array',
    snippet: JSON.stringify(search).substring(0, 1000),
  } : search;

  results.windowUrls = typeof urls === 'object' ? Object.keys(urls).slice(0, 20) : String(urls).substring(0, 300);

  // Try immoweb's classified API with correct format
  const apiTests = [
    'https://api.immoweb.be/classifieds/search?countries=LU&transactionTypes=FOR_SALE&propertyTypes=HOUSE&size=5&page=1',
    'https://api.immoweb.be/classifieds?countries=LU&transactionTypes=FOR_SALE&size=5',
    'https://www.immoweb.be/fr/recherche/maison/a-vendre/luxembourg?orderBy=newest&json=1',
  ];
  results.apiTests = [];
  for (const url of apiTests) {
    try {
      const ar = await fetch(url, { headers: { ...HEADERS, Accept: 'application/json', Referer: 'https://www.immoweb.be/' } });
      const text = await ar.text();
      results.apiTests.push({ url, status: ar.status, size: text.length, preview: text.substring(0, 400) });
    } catch(e) { results.apiTests.push({ url, error: e.message.substring(0, 60) }); }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results, null, 2),
  };
};
