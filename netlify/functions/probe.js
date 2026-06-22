const SITES = [
  { name: 'remax',      url: 'https://www.remax.lu/buy/' },
  { name: 'era',        url: 'https://www.era.lu/fr/biens-a-vendre/' },
  { name: 'immotop',    url: 'https://www.immotop.lu/vente/' },
  { name: 'wort',       url: 'https://immo.wort.lu/fr/annonces/vente' },
  { name: 'homegate',   url: 'https://www.homegate.lu/buy/real-estate/luxembourg/matching-list' },
  { name: 'immoscout',  url: 'https://www.immoscout24.lu/fr/immobilier/acheter' },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

exports.handler = async () => {
  const results = await Promise.all(SITES.map(async (site) => {
    try {
      const r = await fetch(site.url, { headers: HEADERS, redirect: 'follow' });
      const text = await r.text();
      const hasInitialState = text.includes('__INITIAL_STATE__');
      const hasNextData = text.includes('__NEXT_DATA__');
      const hasNuxt = text.includes('__NUXT__');
      const listingHints = ['"price"', '"surface"', '"bedroom"', 'data-listing', 'listing-card']
        .filter(h => text.includes(h)).join(', ');
      return {
        name: site.name, status: r.status, size: text.length,
        hasInitialState, hasNextData, hasNuxt, listingHints,
        preview: text.substring(0, 200),
      };
    } catch (e) {
      return { name: site.name, error: e.message };
    }
  }));
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results, null, 2),
  };
};
