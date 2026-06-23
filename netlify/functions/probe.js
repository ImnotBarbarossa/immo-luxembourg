const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'Referer': 'https://www.immoweb.be/fr/recherche/maison/a-vendre/luxembourg',
  'X-Requested-With': 'XMLHttpRequest',
};

exports.handler = async () => {
  const url = 'https://www.immoweb.be/fr/search-results?countries=LU&transactionTypes=FOR_SALE&propertyTypes=HOUSE&orderBy=newest&size=5&page=1';
  const r = await fetch(url, { headers: HEADERS });
  const data = await r.json();

  // Return the first 2 results fully so we can understand the structure
  const sample = (data.results || []).slice(0, 2);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totalItems: data.totalItems, currentPage: data.currentPage, sample }, null, 2),
  };
};
