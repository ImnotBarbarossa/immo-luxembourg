const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

exports.handler = async () => {
  const results = {};

  // 1. Extract window.urls from immoweb to find the real JSON search endpoint
  try {
    const r = await fetch('https://www.immoweb.be/fr/recherche/maison/a-vendre/luxembourg?orderBy=newest', { headers: HEADERS });
    const html = await r.text();

    const marker = 'window.urls = ';
    const idx = html.indexOf(marker);
    if (idx >= 0) {
      const start = idx + marker.length;
      let depth = 0, i = start;
      while (i < html.length && i < start + 10000) {
        const c = html[i];
        if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') { depth--; if (depth <= 0) { i++; break; } }
        else if (depth === 0 && (c === ';' || c === '\n')) break;
        i++;
      }
      const raw = html.substring(start, i).trim().replace(/;$/, '');
      try {
        const urls = JSON.parse(raw);
        results.immoweb_urls = urls;
        // Try the searchResultsJsonUrl
        if (urls.searchResultsJsonUrl) {
          const apiUrl = urls.searchResultsJsonUrl + '?countries=LU&transactionTypes=FOR_SALE&propertyTypes=HOUSE&orderBy=newest&size=5';
          const ar = await fetch(apiUrl, { headers: { ...HEADERS, Referer: 'https://www.immoweb.be/' } });
          const text = await ar.text();
          results.searchApiTest = { url: apiUrl, status: ar.status, size: text.length, preview: text.substring(0, 500) };
        }
      } catch(e) { results.immoweb_urls_err = e.message; }
    }
  } catch(e) { results.immoweb_err = e.message; }

  // 2. Test wort.lu immo section
  const wortUrls = [
    'https://immo.wort.lu/fr/annonces/maison/vente',
    'https://www.wort.lu/fr/immobilier/achat',
    'https://immo.wort.lu/',
    'https://immo.wort.lu/fr/',
  ];
  results.wort_tests = [];
  for (const url of wortUrls) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      const text = await r.text();
      results.wort_tests.push({
        url, status: r.status, size: text.length,
        hasNextData: text.includes('__NEXT_DATA__'),
        hasInitial: text.includes('__INITIAL_STATE__'),
        hasNuxt: text.includes('__NUXT__'),
        preview: text.substring(0, 200),
      });
    } catch(e) { results.wort_tests.push({ url, error: e.message.substring(0, 80) }); }
  }

  // 3. Test property.lu
  try {
    const r = await fetch('https://www.property.lu/fr/vente/', { headers: HEADERS });
    const text = await r.text();
    results.property_lu = {
      status: r.status, size: text.length,
      hasNextData: text.includes('__NEXT_DATA__'),
      hasInitial: text.includes('__INITIAL_STATE__'),
      preview: text.substring(0, 200),
    };
  } catch(e) { results.property_lu = { error: e.message }; }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results, null, 2),
  };
};
