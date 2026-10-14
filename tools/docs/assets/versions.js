// Version selectors for generated docs. Each select[data-doc-version] holds full page URLs for the
// same slug in another pair; choosing one navigates there and keeps the current #hash.
// Without JS the noscript links in .docs-versions are the navigation path.
(function () {
  document.documentElement.classList.add('docs-js');
  const selects = document.querySelectorAll('select[data-doc-version]');

  function go(select) {
    const target = new URL(select.value, location.href);
    if (location.hash) target.hash = location.hash;
    if (target.href !== location.href) location.assign(target.href);
  }

  for (const select of selects) select.addEventListener('change', () => go(select));

  // Back/forward (bfcache) and form-state restore can leave a select on a value picked before navigating away.
  window.addEventListener('pageshow', () => {
    for (const select of selects) for (const option of select.options) option.selected = option.defaultSelected;
  });

  // The catalog receives ?missing=SLUG&server=SERVER_ID&library=LIBRARY_ID when a selector choice's pair lacks the page.
  const article = document.querySelector('article.docs-prose');
  const params = new URLSearchParams(location.search);
  const missing = params.get('missing');
  if (article && missing && /^\/docs\/versions\/(index\.html)?$/.test(location.pathname)) {
    const note = document.createElement('p');
    note.className = 'docs-version-note';
    note.textContent = `The page ${missing} is not available for server ${params.get('server') || 'unknown'} and library ${params.get('library') || 'unknown'}. Choose a version in the documentation navigation.`;
    const heading = article.querySelector('h1');
    article.insertBefore(note, heading || article.firstChild);
  }
})();
