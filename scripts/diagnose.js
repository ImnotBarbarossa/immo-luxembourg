// Diagnostic v3 : extraction exacte des données de chaque site.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

async function get(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'fr-BE,fr;q=0.9' },
    redirect: 'follow',
  });
  return { status: resp.status, body: await resp.text() };
}

// Extrait un tableau JSON complet en partant d'un index dans le tableau,
// en remontant au '[' ouvrant puis en comptant les crochets (hors chaînes)
function extractJsonArray(text, insideIdx) {
  let start = text.lastIndexOf('[', insideIdx);
  while (start > 0) {
    try {
      const arr = scanArray(text, start);
      if (arr) return arr;
    } catch { /* continue */ }
    start = text.lastIndexOf('[', start - 1);
  }
  return null;
}
function scanArray(text, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  return null;
}

const ZONE = /^(6700|6704|6706|6717|6720|6721|6723|6724|6780|6781|6782)$/;

(async () => {
  // ── HONESTY ────────────────────────────────────────────────────────────────
  console.log('════ HONESTY ════');
  const hon = await get('https://www.honesty.be/biens-a-vendre/?purpose=%5B1%2C3%5D&displayStatusIdList=%5B2%5D&category=1&maxprice=600000');
  console.log('HTTP', hon.status);
  const anchor = hon.body.indexOf('"purposeId"');
  const estates = anchor !== -1 ? extractJsonArray(hon.body, anchor) : null;
  if (estates) {
    console.log('estates count:', estates.length);
    const zone = estates.filter((e) => ZONE.test(String(e.zip || '')));
    console.log('estates en zone:', zone.length, '| zips zone:', zone.map((e) => e.zip).join(','));
    const sample = zone[0] || estates[0];
    // Champs compacts (sans les textes longs)
    const compact = {};
    for (const [k, v] of Object.entries(sample)) {
      if (typeof v === 'string' && v.length > 120) compact[k] = v.slice(0, 100) + '…';
      else if (Array.isArray(v)) compact[k] = `[${v.length} items] ` + JSON.stringify(v[0] || '').slice(0, 150);
      else if (v && typeof v === 'object') compact[k] = JSON.stringify(v).slice(0, 150);
      else compact[k] = v;
    }
    console.log('sample estate:', JSON.stringify(compact, null, 1).slice(0, 3000));
    // Test des URLs de détail candidates
    const id = sample.id || sample.estateId;
    for (const cand of [
      `https://www.honesty.be/biens-a-vendre/?inputestateid=${id}`,
      `https://www.honesty.be/bien/?id=${id}`,
    ]) {
      try {
        const r = await get(cand);
        const hasRef = sample.referenceNumber && r.body.includes(sample.referenceNumber);
        console.log('detail candidate:', cand, '→', r.status, 'len', r.body.length, 'containsRef:', hasRef);
      } catch (e) { console.log('detail candidate:', cand, '→ ERR', e.message); }
    }
  } else {
    console.log('PAS de tableau estates trouvé !');
  }

  // ── WIMMO ──────────────────────────────────────────────────────────────────
  console.log('\n════ WIMMO ════');
  const wim = await get('https://www.wimmobiliere.com/rechercher/biens?SortFields=ID+DESC&Goal=0&WebIDs=1&PriceTo=600000');
  console.log('HTTP', wim.status);
  const divIdx = wim.body.indexOf('properties-locations-json');
  if (divIdx !== -1) {
    const arrStart = wim.body.indexOf('[', divIdx);
    const props = scanArray(wim.body, arrStart);
    console.log('properties count:', props ? props.length : null);
    if (props && props.length) {
      console.log('first 3:', JSON.stringify(props.slice(0, 3), null, 1));
      const zone = props.filter((p) => /arlon|attert|habay|messancy|bonnert|hachy|marbehan|wolkrange|nothomb|anlier/i.test(p.link || ''));
      console.log('en zone (par slug):', zone.length);
      zone.slice(0, 5).forEach((p) => console.log('  •', p.title, p.link));
    }
  } else {
    console.log('div properties-locations-json introuvable');
  }

  // ── ERA : trouver le lien des cartes ───────────────────────────────────────
  console.log('\n════ ERA ════');
  const era = await get('https://www.era.be/fr/a-vendre?pager%5Blimit%5D=24&broker_id=6000144&filter%5Blocation%5D%5Bmunicipalities%5D=187+181&filter%5Bproperty_type%5D=46');
  console.log('HTTP', era.status);
  const teaserIdx = era.body.indexOf('property-teaser');
  if (teaserIdx !== -1) {
    // Remonte jusqu'à l'article englobant et dump le début (avec l'ancre ?)
    const artStart = era.body.lastIndexOf('<article', teaserIdx);
    const before = era.body.slice(Math.max(0, artStart - 1500), artStart);
    console.log('AVANT article:', before.replace(/\s+/g, ' ').slice(-1200));
    console.log('DÉBUT article:', era.body.slice(artStart, artStart + 800).replace(/\s+/g, ' '));
    // Toutes les ancres dans un rayon de 6000 chars autour du teaser
    const zone6k = era.body.slice(Math.max(0, teaserIdx - 3000), teaserIdx + 3000);
    const hrefs = [...zone6k.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]);
    console.log('ancres autour du teaser:', JSON.stringify([...new Set(hrefs)], null, 1));
  }
  // data-nid → tester l'URL /fr/node/{nid}
  const nid = (era.body.match(/data-nid="(\d+)"/) || [])[1];
  if (nid) {
    const r = await get(`https://www.era.be/fr/node/${nid}`);
    console.log(`/fr/node/${nid} →`, r.status, '| title:', (r.body.match(/<title>([^<]*)</) || [])[1]);
  }
})();
