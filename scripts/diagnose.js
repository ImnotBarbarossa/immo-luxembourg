// Diagnostic v5 : validation de bout en bout du handler réel + URL détail Honesty
const handler = require('../api/listings.js');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

async function get(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'fr-BE,fr;q=0.9' },
    redirect: 'follow',
  });
  return { status: resp.status, body: await resp.text() };
}

function run(query) {
  return new Promise((resolve) => {
    const req = { method: 'GET', query };
    const res = { status(c) { this.code = c; return this; }, json(o) { resolve(o); return this; } };
    handler(req, res);
  });
}

const ZONE = new Set(['6700','6704','6706','6717','6720','6721','6723','6724','6780','6781','6782']);

(async () => {
  console.log('════ TEST 1 : recherche par défaut (4 façades, 600k) ════');
  const r1 = await run({ fourFacades: '1', budget: '600000' });
  console.log('sources:', JSON.stringify(r1.sources));
  for (const l of r1.listings) {
    console.log(`  [${l.source}] ${l.price}€ | ${l.location} | ${String(l.title).slice(0, 55)} | ${l.url}`);
  }

  console.log('\n════ TEST 2 : commune attert ════');
  const r2 = await run({ region: 'attert', fourFacades: '1' });
  console.log('sources:', JSON.stringify(r2.sources));
  r2.listings.slice(0, 6).forEach((l) => console.log(`  [${l.source}] ${l.location} | ${String(l.title).slice(0, 50)}`));

  console.log('\n════ TEST 3 : URL de détail Honesty valide ? ════');
  const hon = r1.listings.find((l) => l.source === 'honesty');
  if (hon) {
    console.log('bien complet:', JSON.stringify(hon));
    const r = await get(hon.url);
    console.log(hon.url, '→', r.status, '| title:', (r.body.match(/<title>([^<]*)</) || [])[1]);
  } else {
    console.log('aucun bien honesty dans la zone actuellement — sources.errors:', JSON.stringify(r1.sources.errors));
  }

  console.log('\n════ TEST 4 : URLs de détail (1 par source) ════');
  for (const src of ['immoweb', 'wimmo', 'era']) {
    const l = r1.listings.find((x) => x.source === src);
    if (!l) { console.log(`  ${src}: aucun bien`); continue; }
    try {
      const r = await get(l.url);
      console.log(`  ${src}: ${l.url} → ${r.status}`);
    } catch (e) { console.log(`  ${src}: ${l.url} → ERR ${e.message}`); }
  }

  console.log('\n════ VÉRIFS ════');
  let bad = 0;
  for (const l of r1.listings) {
    if (l.price && l.price > 600000) { console.log('❌ budget dépassé:', l.id, l.price); bad++; }
    if (!l.url || !/^https?:\/\//.test(l.url)) { console.log('❌ URL invalide:', l.id, l.url); bad++; }
  }
  console.log(bad === 0 ? '✅ budget + URLs OK sur tous les biens' : `${bad} problèmes`);
  process.exit(0);
})();
