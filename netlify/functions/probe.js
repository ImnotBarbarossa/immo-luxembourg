const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

exports.handler = async () => {
  const tests = [
    // Sites with Luxembourg listings
    { name: 'seloger_lu',      url: 'https://www.seloger.com/immobilier/achat/luxembourg/' },
    { name: 'logicimmo_com',   url: 'https://www.logic-immo.com/vente-immobilier-luxembourg/' },
    { name: 'immoweb_lu',      url: 'https://www.immoweb.be/fr/recherche/maison/a-vendre/luxembourg' },
    { name: 'bienici_lu',      url: 'https://www.bienici.com/recherche/achat/luxembourg' },
    { name: 'lux_remax_search',url: 'https://www.remax.lu/buy/?countryId=LU' },
    // Try athome.lu with different search params - houses specifically
    { name: 'athome_maison',   url: 'https://www.athome.lu/srp/?tr=buy&q=Luxembourg&idtype[]=2' },
    { name: 'athome_appart',   url: 'https://www.athome.lu/srp/?tr=buy&q=Luxembourg&idtype[]=1' },
    // Try remax.lu search directly with params in URL
    { name: 'remax_search',    url: 'https://www.remax.lu/buy/?country=LU&transaction=buy' },
    // Try ERA with different path
    { name: 'era_fr',          url: 'https://www.era.lu/fr/acheter/' },
    { name: 'era_api',         url: 'https://www.era.lu/api/properties?country=LU&transaction=buy' },
  ];

  const results = await Promise.all(tests.map(async (t) => {
    try {
      const r = await fetch(t.url, { headers: HEADERS, redirect: 'follow' });
      const text = await r.text();
      return {
        name: t.name, status: r.status, size: text.length,
        hasInitialState: text.includes('__INITIAL_STATE__'),
        hasNextData: text.includes('__NEXT_DATA__'),
        hasNuxt: text.includes('__NUXT__'),
        hasPrice: text.includes('"price"') || text.includes('data-price'),
        preview: text.substring(0, 200),
      };
    } catch(e) {
      return { name: t.name, error: e.message.substring(0, 80) };
    }
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results, null, 2),
  };
};
