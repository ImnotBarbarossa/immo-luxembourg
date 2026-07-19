// Diagnostic v4 : Honesty (ancrage putOnlineDateTime + URL détail), ERA (ancre carte)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

async function get(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'fr-BE,fr;q=0.9' },
    redirect: 'follow',
  });
  return { status: resp.status, body: await resp.text() };
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
function extractJsonArray(text, insideIdx) {
  let start = text.lastIndexOf('[', insideIdx);
  let tries = 0;
  while (start > 0 && tries < 30) {
    try {
      const arr = scanArray(text, start);
      if (arr && Array.isArray(arr) && arr.length && typeof arr[0] === 'object') return arr;
    } catch { /* continue */ }
    start = text.lastIndexOf('[', start - 1);
    tries++;
  }
  return null;
}

(async () => {
  // ── HONESTY ────────────────────────────────────────────────────────────────
  console.log('════ HONESTY ════');
  const hon = await get('https://www.honesty.be/biens-a-vendre/?purpose=%5B1%2C3%5D&displayStatusIdList=%5B2%5D&category=1&maxprice=600000');
  console.log('HTTP', hon.status, 'len', hon.body.length);
  const anchor = hon.body.indexOf('"putOnlineDateTime"');
  console.log('anchor putOnlineDateTime @', anchor);
  const estates = anchor !== -1 ? extractJsonArray(hon.body, anchor) : null;
  if (estates) {
    console.log('estates count:', estates.length);
    const ZONE = /^(6700|6704|6706|6717|6720|6721|6723|6724|6780|6781|6782)$/;
    const zone = estates.filter((e) => ZONE.test(String(e.zip || '')));
    console.log('en zone:', zone.length, '| zips:', zone.map((e) => e.zip).join(','));
    const s = zone[0] || estates[0];
    const compact = {};
    for (const [k, v] of Object.entries(s)) {
      if (v == null) continue;
      if (typeof v === 'string' && v.length > 100) compact[k] = v.slice(0, 80) + '…';
      else if (Array.isArray(v)) compact[k] = `[${v.length}] ` + JSON.stringify(v[0] || '').slice(0, 120);
      else if (typeof v === 'object') compact[k] = JSON.stringify(v).slice(0, 120);
      else compact[k] = v;
    }
    console.log('sample:', JSON.stringify(compact, null, 1).slice(0, 2500));
    // Comment le front construit-il l'URL de détail ?
    for (const key of ['inputestateid', 'estateid', 'detail']) {
      const i = hon.body.toLowerCase().indexOf(key);
      if (i !== -1) console.log(`[${key}] …${hon.body.slice(Math.max(0, i - 250), i + 250).replace(/\s+/g, ' ')}…`);
    }
    const id = s.id;
    for (const cand of [
      `https://www.honesty.be/biens-a-vendre/?inputestateid=${id}`,
      `https://www.honesty.be/detail/?estateid=${id}`,
    ]) {
      try {
        const r = await get(cand);
        console.log('candidate:', cand, '→', r.status, 'len', r.body.length,
          'ref présent:', s.referenceNumber ? r.body.includes(String(s.referenceNumber)) : '?',
          'title:', (r.body.match(/<title>([^<]*)</) || [])[1]);
      } catch (e) { console.log('candidate ERR', cand, e.message); }
    }
  } else {
    console.log('estates introuvables ; contexte:', hon.body.slice(Math.max(0, anchor - 400), anchor + 100).replace(/\s+/g, ' '));
  }

  // ── ERA ────────────────────────────────────────────────────────────────────
  console.log('\n════ ERA ════');
  const era = await get('https://www.era.be/fr/a-vendre?pager%5Blimit%5D=24&broker_id=6000144&filter%5Blocation%5D%5Bmunicipalities%5D=187+181&filter%5Bproperty_type%5D=46');
  console.log('HTTP', era.status, 'len', era.body.length);
  const priceIdx = era.body.indexOf('field--price');
  if (priceIdx !== -1) {
    // 5000 chars avant le prix : l'ancre de la carte doit s'y trouver
    const back = era.body.slice(Math.max(0, priceIdx - 5000), priceIdx);
    const hrefs = [...back.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]);
    console.log('ancres avant field--price:', JSON.stringify(hrefs.slice(-6), null, 1));
    // data-nid et le node
    const nid = (era.body.match(/data-nid="(\d+)"/) || [])[1];
    console.log('premier data-nid:', nid);
    if (nid) {
      const r = await get(`https://www.era.be/fr/node/${nid}`);
      console.log(`/fr/node/${nid} →`, r.status, '| title:', (r.body.match(/<title>([^<]*)</) || [])[1]);
    }
    // le teaser complet du 1er bien pour voir la structure
    console.log('teaser:', era.body.slice(priceIdx - 600, priceIdx + 700).replace(/\s+/g, ' '));
  }
})();
