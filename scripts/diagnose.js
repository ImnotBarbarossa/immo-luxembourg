// Diagnostic v7 : pourquoi Honesty renvoie 0 bien en zone ?
const path = require('path');
const listings = require('../api/listings.js');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

async function get(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'fr-BE,fr;q=0.9' },
    redirect: 'follow',
  });
  return { status: resp.status, body: await resp.text() };
}

// Ré-implémente l'extracteur pour inspection (copie de api/listings.js)
function scanObjectEnd(text, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}
function extractWhiseEstates(html) {
  const estates = [];
  let idx = -1;
  while ((idx = html.indexOf('"putOnlineDateTime"', idx + 1)) !== -1) {
    let probe = idx;
    for (let t = 0; t < 300 && probe > 0; t++) {
      probe = html.lastIndexOf('{', probe - 1);
      if (probe === -1) break;
      const end = scanObjectEnd(html, probe);
      if (end > idx) {
        try {
          const obj = JSON.parse(html.slice(probe, end + 1));
          if (obj && typeof obj === 'object' && 'putOnlineDateTime' in obj) {
            estates.push(obj); idx = end; break;
          }
        } catch { /* continuer */ }
      }
    }
  }
  return estates;
}

(async () => {
  for (const [label, url] of [
    ['searchinput=6700', 'https://www.honesty.be/biens-a-vendre/?purpose=%5B1%2C3%5D&displayStatusIdList=%5B2%5D&category=1&searchinput=6700&searchtxtinput=6700&searchziplabel=6700&maxprice=600000'],
    ['lien exact utilisateur (6717)', 'https://www.honesty.be/biens-a-vendre/?purpose=%5B1%2C3%5D&orderByField=Zip&orderSorting=ASC&displayStatusIdList=%5B2%5D&searchtxtinput=Attert+%286717%29&searchinput=6717&searchziplabel=Attert+%286717%29&category=1&rooms=0&minprice=&maxprice=600000&inputestateid='],
    ['sans filtre', 'https://www.honesty.be/biens-a-vendre/'],
  ]) {
    const r = await get(url);
    const estates = extractWhiseEstates(r.body);
    const zips = [...new Set(estates.map((e) => e.zip))].sort();
    console.log(`\n[${label}] HTTP ${r.status} len ${r.body.length} | estates: ${estates.length}`);
    console.log('  zips:', zips.join(','));
    if (estates[0]) {
      const e = estates.find((x) => String(x.zip || '').startsWith('67')) || estates[0];
      console.log('  sample: id=%s zip=%s city=%s price=%s name=%s purposeId=%s categoryId=%s',
        e.id, e.zip, e.city, e.price, String(e.name || '').slice(0, 40), e.purposeId, e.categoryId);
      const picKeys = Object.keys(e).filter((k) => /pic|image|photo/i.test(k));
      console.log('  champs images:', picKeys.join(','), '| premier:',
        picKeys[0] ? JSON.stringify(e[picKeys[0]]).slice(0, 150) : 'aucun');
    }
    // La page fait-elle du chargement AJAX pour la liste ?
    const ajaxIdx = r.body.indexOf('admin-ajax');
    if (ajaxIdx !== -1) console.log('  admin-ajax ctx:', r.body.slice(ajaxIdx - 200, ajaxIdx + 200).replace(/\s+/g, ' '));
  }
})();
