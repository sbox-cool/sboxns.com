// Client-side docs search over /docs/search-index.json. No external service.
(function () {
  const input = document.getElementById('docs-q');
  const box = document.getElementById('docs-results');
  if (!input || !box) return;
  let index = null;
  const indexUrl = input.closest('[data-index]').dataset.index;
  const load = () => index || (index = fetch(indexUrl).then((r) => r.json()));
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function score(entry, terms) {
    let total = 0;
    for (const term of terms) {
      const t = entry.t.toLowerCase(), h = entry.h.toLowerCase(), x = entry.x.toLowerCase();
      if (t.includes(term)) total += 10;
      else if (h.includes(term)) total += 4;
      else if (x.includes(term)) total += 1;
      else return 0;
    }
    return total;
  }

  async function run() {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    const entries = await load();
    const terms = q.split(/\s+/);
    const hits = entries.map((e) => [score(e, terms), e]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, 8);
    box.innerHTML = hits.length
      ? hits.map(([, e]) => `<a href="${esc(e.u)}"><strong>${esc(e.t)}</strong><span>${esc(e.s)}</span></a>`).join('')
      : '<p>No results.</p>';
    box.hidden = false;
  }

  input.addEventListener('input', run);
  input.addEventListener('focus', load);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { input.value = ''; run(); }
    if (event.key === 'Enter') { const first = box.querySelector('a'); if (first) location.href = first.href; }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== input && !/input|textarea/i.test(document.activeElement.tagName)) {
      event.preventDefault(); input.focus();
    }
  });
  document.addEventListener('click', (event) => { if (!event.target.closest('.docs-search')) box.hidden = true; });
})();
