const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'Referer': 'https://www.immoweb.be/fr/recherche/maison/a-vendre/luxembourg',
  'X-Requested-With': 'XMLHttpRequest',
};

exports.handler = async () => {
  const results = {};

  // Test the immoweb JSON search endpoint
  const apiBase = 'https://www.immoweb.be/fr/search-results';

  const testUrls = [
    `${apiBase}?countries=LU&transactionTypes=FOR_SALE&propertyTypes=HOUSE&orderBy=newest&size=5&page=1`,
    `${apiBase}?countries=LU&transactionTypes=FOR_SALE&orderBy=newest&size=5&page=1`,
  ];

  results.immowebApi = [];
  for (const url of testUrls) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      const text = await r.text();
      const isJson = text.trim().startsWith('{') || text.trim().startsWith('[');
      let parsed = null;
      if (isJson) {
        try { parsed = JSON.parse(text); } catch {}
      }
      results.immowebApi.push({
        url, status: r.status, size: text.length, isJson,
        keys: parsed ? Object.keys(parsed).slice(0, 15) : null,
        totalCount: parsed?.totalCount || parsed?.total,
        resultCount: Array.isArray(parsed?.results) ? parsed.results.length : (Array.isArray(parsed?.classifieds) ? parsed.classifieds.length : null),
        preview: text.substring(0, 600),
      });
    } catch(e) { results.immowebApi.push({ url, error: e.message.substring(0, 100) }); }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results, null, 2),
  };
};
