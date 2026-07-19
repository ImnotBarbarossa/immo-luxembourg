// Diagnostic v2 : extraire la structure exacte des données de chaque site.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

async function get(url, headers = {}) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'fr-BE,fr;q=0.9',
      ...headers,
    },
    redirect: 'follow',
  });
  const body = await resp.text();
  return { status: resp.status, body, ct: resp.headers.get('content-type') };
}

function around(hay, needle, before, after, nth = 0) {
  let idx = -1;
  for (let i = 0; i <= nth; i++) {
    idx = hay.indexOf(needle, idx + 1);
    if (idx === -1) return null;
  }
  return hay.slice(Math.max(0, idx - before), idx + after).replace(/\s+/g, ' ');
}

(async () => {
  // ── HONESTY : trouver le JSON des biens (Whise) ────────────────────────────
  console.log('════ HONESTY ════');
  const hon = await get('https://www.honesty.be/biens-a-vendre/?purpose=%5B1%2C3%5D&displayStatusIdList=%5B2%5D&category=1&maxprice=600000');
  console.log('HTTP', hon.status, 'len', hon.body.length);
  // Où commence la structure de données ? Cherche les clés typiques Whise
  for (const key of ['"purposeId"', '"zip"', '"price"', '"estates"', 'window.', 'estateList']) {
    const ctx = around(hon.body, key, 300, 500);
    if (ctx) console.log(`\n[${key}] …${ctx}…`);
  }
  // Une URL de détail d'annonce ressemble à quoi ?
  const honLinks = [...hon.body.matchAll(/href=["']([^"']*(?:bien|estate|detail|property)[^"']*)["']/gi)].map(m => m[1]).slice(0, 10);
  console.log('\nliens détail candidats:', JSON.stringify(honLinks, null, 1));

  // ── WIMMO : trouver l'endpoint API appelé par le front ─────────────────────
  console.log('\n════ WIMMO ════');
  const wim = await get('https://www.wimmobiliere.com/rechercher/biens?SortFields=ID+DESC&Goal=0&WebIDs=1&Zips%5B%5D=6717&PriceTo=600000');
  console.log('HTTP', wim.status, 'len', wim.body.length);
  for (const key of ['/api/', 'fetch(', 'axios', '.json', 'ajax', 'estates', 'Omnicasa', 'whise', 'GetProperties']) {
    const ctx = around(wim.body, key, 250, 400);
    if (ctx) console.log(`\n[${key}] …${ctx}…`);
  }
  const wimScripts = [...wim.body.matchAll(/<script[^>]*src=["']([^"']+)["']/gi)].map(m => m[1]);
  console.log('\nscripts:', JSON.stringify(wimScripts, null, 1));
  // Contexte des 4 € trouvés
  for (let i = 0; i < 4; i++) {
    const ctx = around(wim.body, '€', 250, 100, i);
    if (ctx) console.log(`\n€[${i}] …${ctx}…`);
  }

  // ── WIMMO : tenter le JS principal pour trouver l'API ─────────────────────
  const mainJs = wimScripts.find(s => /app|main|index/.test(s));
  if (mainJs) {
    try {
      const jsUrl = new URL(mainJs, 'https://www.wimmobiliere.com').href;
      const js = await get(jsUrl);
      console.log('\nmain JS:', jsUrl, 'HTTP', js.status, 'len', js.body.length);
      for (const key of ['/api/', 'rechercher', 'GetEstate', 'properties', 'baseURL']) {
        const ctx = around(js.body, key, 200, 300);
        if (ctx) console.log(`\nJS[${key}] …${ctx}…`);
      }
    } catch (e) { console.log('main JS error:', e.message); }
  }

  // ── ERA : structure des cartes (prix hors ancre) ───────────────────────────
  console.log('\n════ ERA ════');
  const era = await get('https://www.era.be/fr/a-vendre?pager%5Blimit%5D=24&broker_id=6000144&filter%5Blocation%5D%5Bmunicipalities%5D=187+181&filter%5Blocation%5D%5Bsub_municipalities%5D=796+946+1386+1450+2536+2008+2019+2501+2543&filter%5Bproperty_type%5D=46&filter%5Bprice%5D=%28min%3A%3Bmax%3A600000%29');
  console.log('HTTP', era.status, 'len', era.body.length);
  // Contexte complet autour des 3 premiers €
  for (let i = 0; i < 3; i++) {
    const ctx = around(era.body, '€', 1500, 300, i);
    if (ctx) console.log(`\n€[${i}] …${ctx}…\n`);
  }
  const eraLinks = [...era.body.matchAll(/href=["']([^"']*\/fr\/[^"']*)["']/gi)]
    .map(m => m[1]).filter(h => !/a-vendre|a-louer|agences|estimation|contact|jobs|blog|#|\?/.test(h)).slice(0, 15);
  console.log('liens candidats:', JSON.stringify([...new Set(eraLinks)], null, 1));
})();
