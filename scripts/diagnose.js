// Diagnostic des 4 sources : exécute le handler réel puis, pour chaque source
// vide ou en erreur, récupère la page brute et imprime des indices de structure.
const handler = require('../api/listings.js');

const URLS = {
  immoweb: 'https://www.immoweb.be/fr/search-results?countries=BE&postalCodes=6700,6704,6706,6717,6720,6721,6723,6724,6780,6781,6782&transactionTypes=FOR_SALE&propertyTypes=HOUSE&orderBy=newest&size=30&page=1&minFacadeCount=4',
  honesty: 'https://www.honesty.be/biens-a-vendre/?purpose=%5B1%2C3%5D&displayStatusIdList=%5B2%5D&category=1&orderByField=Zip&orderSorting=ASC&maxprice=600000',
  wimmo: 'https://www.wimmobiliere.com/rechercher/biens?SortFields=ID+DESC&Goal=0&WebIDs=1&Zips%5B%5D=6700&Zips%5B%5D=6704&Zips%5B%5D=6706&Zips%5B%5D=6717&Zips%5B%5D=6720&Zips%5B%5D=6721&Zips%5B%5D=6723&Zips%5B%5D=6724&Zips%5B%5D=6780&Zips%5B%5D=6781&Zips%5B%5D=6782&PriceTo=600000&Price=%7C600000',
  era: 'https://www.era.be/fr/a-vendre?pager%5Blimit%5D=24&broker_id=6000144&filter%5Blocation%5D%5Bmunicipalities%5D=187+181&filter%5Blocation%5D%5Bsub_municipalities%5D=796+946+1386+1450+2536+2008+2019+2501+2543&filter%5Bproperty_type%5D=46&filter%5Bprice%5D=%28min%3A%3Bmax%3A600000%29',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

function probeHtml(html) {
  const marks = {
    length: html.length,
    euroSigns: (html.match(/€/g) || []).length,
    anchors: (html.match(/<a\b/gi) || []).length,
    imgs: (html.match(/<img\b/gi) || []).length,
    nextData: html.includes('__NEXT_DATA__'),
    nuxt: html.includes('__NUXT__'),
    initialState: html.includes('__INITIAL_STATE__'),
    ldJson: (html.match(/application\/ld\+json/g) || []).length,
    adminAjax: html.includes('admin-ajax.php'),
    wpJson: html.includes('/wp-json/'),
    datadome: /datadome/i.test(html),
    cloudflare: /cf-browser-verification|challenge-platform|cloudflare/i.test(html),
    captcha: /captcha/i.test(html),
  };
  return marks;
}

function sampleAnchorsWithPrice(html) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 5) {
    const text = m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (/€/.test(text)) out.push({ href: m[1].slice(0, 120), text: text.slice(0, 160) });
  }
  return out;
}

function sampleLdJson(html) {
  const out = [];
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 2) out.push(m[1].slice(0, 800));
  return out;
}

async function rawProbe(name, url) {
  console.log(`\n──── PROBE ${name} ────`);
  console.log('URL:', url);
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'fr-BE,fr;q=0.9',
      },
      redirect: 'follow',
    });
    console.log('HTTP', resp.status, '| content-type:', resp.headers.get('content-type'));
    console.log('final URL:', resp.url);
    const body = await resp.text();
    console.log('markers:', JSON.stringify(probeHtml(body)));
    const anchors = sampleAnchorsWithPrice(body);
    console.log('anchors avec € :', anchors.length);
    anchors.forEach((a) => console.log('  •', a.href, '||', a.text));
    const ld = sampleLdJson(body);
    ld.forEach((s, i) => console.log(`ld+json[${i}]:`, s.replace(/\s+/g, ' ').slice(0, 500)));
    // Aperçu du body (début + zone médiane) pour repérer la structure
    console.log('body[0:1200]:', body.slice(0, 1200).replace(/\s+/g, ' '));
    const mid = Math.floor(body.length / 2);
    console.log(`body[${mid}:${mid + 800}]:`, body.slice(mid, mid + 800).replace(/\s+/g, ' '));
  } catch (e) {
    console.log('FETCH ERROR:', e.message);
  }
}

(async () => {
  console.log('════ ÉTAPE 1 : handler réel ════');
  const req = { method: 'GET', query: { fourFacades: '1', budget: '600000' } };
  const result = await new Promise((resolve) => {
    const res = { status(c) { this.code = c; return this; }, json(o) { resolve(o); return this; } };
    handler(req, res);
  });
  console.log('sources:', JSON.stringify(result.sources, null, 2));
  for (const l of result.listings.slice(0, 8)) {
    console.log(`  [${l.source}] ${l.price}€ ${l.location} | ${l.title.slice(0, 60)} | ${l.url}`);
  }

  console.log('\n════ ÉTAPE 2 : probes bruts ════');
  for (const [name, url] of Object.entries(URLS)) {
    await rawProbe(name, url);
  }
})();
