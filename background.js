// Super CDesign — accès au serveur local de preview mobile.
// (Seul le service worker peut joindre localhost : la page claude.ai en est
// empêchée par sa CSP et par les restrictions d'accès au réseau local.)

const SERVER = 'http://localhost:4321';

async function qr() {
  try {
    const res = await fetch(`${SERVER}/api/qr`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { url, svg, dir } = await res.json();
    return { ok: true, url, svg, dir };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'superdesign-qr') return;
  qr().then(sendResponse);
  return true; // réponse asynchrone
});
