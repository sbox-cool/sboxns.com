# Docs generator

`/docs/` on sboxns.com is generated, not hand-written. Edit the sources instead:

| Pages | Source |
| --- | --- |
| Guides (connect a game, self-hosting, configuration, ...) | `docs/*.md` in sbox-cool/sbox-network-storage-server |
| Library guides | `README.md`, `source-authoring.md`, `Examples/README.md`, `docs/*.md` in sbox-cool/sbox-network-storage |
| HTTP API reference | Route definitions in the server's `src/SboxNetworkStorage.Server/Endpoints/`, checked against `tests/parity/corpus/` |
| C# API reference | Public types and `///` comments under the library's `Code/` |

The page list and navigation live in `build.mjs` (`PAGE_DEFS`, `SECTIONS`).

## Regenerate

```sh
cd tools/docs
npm ci
npm run build           # node versions.mjs: all pair snapshots, default /docs/ pages, catalog
npm run check:links     # node check-links.mjs: fails on any broken internal link or anchor
npm test                # version isolation, historical public API and publication boundaries
```

`versions.mjs` takes no options. Source refs come only from the curated `versions.json` (see Versions below); there is no ref override. `build.mjs` is invoked by the orchestrator with pinned commits and is not run by hand for regeneration.

The build fails when a request in the server's HTTP contract tests has no matching route, so the API reference cannot silently drift from the server. It also rewrites `sitemap.xml` and `llms.txt`.

The **Regenerate docs** workflow (`.github/workflows/docs.yml`) builds, checks links and runs the version regressions daily, on demand, and for pull requests affecting the generator. Pull requests only verify; scheduled/manual runs commit changed output to `main` and request a GitHub Pages build. Commit the generated `docs/` folder when you build locally; GitHub Pages serves it as static files.

## Versions

`versions.mjs` (`npm run build`) is the entrypoint for versioned output. It:

1. reads the curated manifest `versions.json`;
2. checks that every entry's `ref` still resolves to its pinned `commit`, and fails if a ref has moved;
3. runs `build.mjs` for the default pair at the unversioned `/docs/` paths;
4. runs `build.mjs` once for every server × library pair at `/docs/versions/<server>/<library>/`;
5. writes the generated `docs/versions.json`, `docs/versions.js`, the `/docs/versions/` catalog, and the sitemap and `llms.txt` entries.

The generated `docs/versions.json` is output only. Edit the curated `tools/docs/versions.json`.

### Manifest

- `servers`: the nine stable releases 0.1.0, 0.2.0, 0.3.0, 0.4.0, 0.5.0, 0.5.1, 0.5.2, 0.5.3 and 0.5.4. Each entry has `id` and `label` (the version), `ref` (its `vX.Y.Z` tag) and `commit` (full SHA). Prerelease builds are not listed.
- `libraries`: two source snapshots, `source-13f51a8` and `source-d369d1b`. Each has `ref` and `commit` set to the same full SHA.
- `defaults`: `server` and `library` ids of the pair built at unversioned `/docs/`. Currently `0.5.4` and `source-13f51a8`.

Rules:

- **IDs are immutable.** Never rename an id or repoint an existing id to another commit. The build compares against the previously generated catalog and rejects removed/repointed entries. Archive URLs are built from ids.
- Every `commit` is a full 40-character SHA. `ref` is the name the commit was taken from; a moved ref fails the build.
- **Adding a future release:** append a new server or library entry with a new id, its `ref`, and its full `commit`. Then update `defaults` if the new entry should become the default. Existing entries stay as they are.

### Publication

Library entries carry `publication`: evidence about what s&box published. It is independent of the GitHub source commit. A pinned source commit is never publication evidence.

- `status: "unverified"`: no publication evidence is recorded, so `revision` and `evidence` must be `null`. It never means published, certified, or compatible with any server.
- `status: "verified"`: `revision` is a numeric s&box revision string and `evidence` is an `https://` URL. The orchestrator rejects any other values.

Both current library snapshots are `unverified`. The catalog shows that status as "GitHub source; s&box publication unverified". A documentation pairing is not a compatibility certification.

To verify a published package, record the exact source commit used for publishing and the package revision assigned by s&box after publishing, with a durable HTTPS evidence link (release notes or a publication record). Confirm the installed package matches that source, excluding publication-generated metadata. Only then change that source entry to `verified`. Neither a matching SemVer nor the repository's `.version` file is sufficient: a stale revision file can remain through later source changes. Keep engine/server compatibility test evidence in the server's compatibility matrix; publication evidence alone does not certify a pairing.

### Pages and selectors

- Each server × library pair is archived at `/docs/versions/<server>/<library>/`. The unversioned `/docs/` pages are the default pair at their existing paths.
- Shared assets stay at the root for every pair: `/docs/docs.css`, `/docs/search.js` and `/docs/versions.js`. Search reads the index URL from the `data-index` attribute on `.docs-search`, so each pair searches its own index.
- The panel `section.docs-versions` has two selects: `select#docs-version-server[data-doc-version="server"]` and `select#docs-version-library[data-doc-version="library"]`. Each option is the same page slug in another pair. Changing one select navigates to that option and keeps the `#hash`; the other axis and the page slug are kept.
- If a selector's pair is built but lacks the slug, the option links to `/docs/versions/?missing=SLUG&server=SERVER_ID&library=LIBRARY_ID` (`SLUG` URL-encoded) and its label gets " (page unavailable)". The catalog then shows a text notice naming the page and pair. Another version's content is never shown in its place. The current pair always links to its own page, and the home page is never missing.
- If a selector's pair was not built at all, its option is disabled with the label "(not built)" and has no link.
- Without JS, `.docs-version-field` is hidden and the `<noscript>` list of `.docs-version-links` in the panel is the way to switch. Its links follow the same rule as the options: the same page where it exists, otherwise the catalog `?missing=` query. Every link is a plain static link.
- Historical content: pages absent from a historical snapshot are omitted, never replaced with today's content.
- `/docs/versions/` is the catalog. It lists every pair with its publication status and links to its `Read docs` page.
