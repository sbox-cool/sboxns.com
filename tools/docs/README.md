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
npm run track:revisions # observe the real published s&box package revision
npm run reconcile:releases # pin new stable server releases and the library main commit in versions.json
npm run build           # node versions.mjs: all pair snapshots, default /docs/ pages, catalog
npm run check:links     # node check-links.mjs: fails on any broken internal link or anchor
npm test                # version isolation, historical public API and publication boundaries
```

`versions.mjs` takes no options. Source refs come only from the curated `versions.json` (see Versions below); there is no ref override. `build.mjs` is invoked by the orchestrator with pinned commits and is not run by hand for regeneration.

The build fails when a request in the server's HTTP contract tests has no matching route, so the API reference cannot silently drift from the server. It also rewrites `sitemap.xml` and `llms.txt`.

The **Regenerate docs** workflow (`.github/workflows/docs.yml`) observes public s&box package revisions, builds, checks links and runs regressions daily, on demand, and for pull requests affecting the generator. Pull requests only verify; scheduled/manual runs commit changed output and revision history to `main` and request a GitHub Pages build. Commit the generated `docs/` folder and `tools/docs/sbox-revisions.json` when you refresh locally; GitHub Pages serves the output as static files.

## Release reconciliation

`npm run reconcile:releases` (`reconcile-releases.mjs`) reads public GitHub state and pins what it finds in `versions.json`:

- **Server releases:** releases of `sbox-cool/sbox-network-storage-server` that are neither draft nor prerelease and whose tag is `vX.Y.Z`. Each tag is peeled to its commit. New releases are appended to `servers`, in ascending order. `defaults.server` moves up to the newest stable release and is never lowered by a backfilled older release. Tags such as `v0.1.0-alpha` are not releases and are ignored.
- **Library `main`:** the head commit of `sbox-cool/sbox-network-storage`, pinned by full SHA. If that commit is not yet in `libraries`, an unverified snapshot is appended with id `source-<7 chars>`. If the short id already names a different commit, the id is `source-<40 chars>`. Its `ref` is the full SHA, not `main`, so the build never follows a moving branch.
- **No re-pointing:** existing entries are never rewritten. If a pinned release tag now resolves to a different commit, the run fails and writes nothing, so a human must decide.

`tools/docs/release-state.json` records what was observed: the library head and its candidate id, the stable releases with their commits and publish dates, a reference to the current s&box observation in `sbox-revisions.json`, and each library's publication status. It is rewritten only when its content changes, so polling does not churn history.

**Publication status** is one of:

- `verified`: `versions.json` carries evidence for the library entry; the revision is recorded.
- `pending`: the newest `main` commit, awaiting publication evidence.
- `unmapped`: any other unverified source snapshot.

A GitHub push or release never sets a publication revision. `pending` and `unmapped` both leave `revision` null. Verifying publication still follows the Publication section below.

**Triggers and credentials:** `.github/workflows/release-reconcile.yml` runs every 15 minutes and on `workflow_dispatch`. It also accepts `repository_dispatch` events `network-storage-library-main` and `network-storage-server-release`, but no sender exists. This repository and the library repository have no GitHub secrets, so nothing is dispatched on a push or release. Until a sender with a credential for this repository is configured, the schedule is the real trigger, with up to 15 minutes of latency plus any GitHub scheduled-run delay.

**Rate limits:** each run makes 3 requests plus one per stable release (the branch head, its commit, the release list and one tag read per release). The workflow passes `GITHUB_TOKEN` so requests use the repository's authenticated limit. Unauthenticated local runs are limited to 60 requests per hour per IP. The token is sent only as an `Authorization` header and is never logged or echoed in errors.

**Gate:** when the reconciled catalog or state changes, the workflow runs `versions.mjs`, `check-links.mjs` and `npm test`. It pushes to `main` only if all three pass, then requests a GitHub Pages build. A catalog the build rejects is never pushed.

Run `npm run reconcile:releases` locally to see what would change. It writes only the files that changed.

## Versions

`versions.mjs` (`npm run build`) is the entrypoint for versioned output. It:

1. reads the curated manifest `versions.json`;
2. checks that every entry's `ref` still resolves to its pinned `commit`, and fails if a ref has moved;
3. runs `build.mjs` for the default pair at the unversioned `/docs/` paths;
4. runs `build.mjs` once for every server × library pair at `/docs/versions/<server>/<library>/`;
5. writes the generated `docs/versions.json`, `docs/versions.js`, the `/docs/versions/` catalog, and the sitemap and `llms.txt` entries.

The generated `docs/versions.json` is output only. Edit the curated `tools/docs/versions.json`.

### Manifest

- `servers`: stable releases, pinned by `reconcile-releases.mjs` (currently 0.1.0 through 0.5.4). Each entry has `id` and `label` (the version), `ref` (its `vX.Y.Z` tag) and `commit` (full SHA). Draft and prerelease releases are not listed.
- `libraries`: two source snapshots, `source-13f51a8` and `source-d369d1b`. Each has `ref` and `commit` set to the same full SHA.
- `defaults`: `server` and `library` ids of the pair built at unversioned `/docs/`. Currently `0.5.4` and `source-13f51a8`.

Rules:

- **IDs are immutable.** Never rename an id or repoint an existing id to another commit. The build compares against the previously generated catalog and rejects removed/repointed entries. Archive URLs are built from ids.
- Every `commit` is a full 40-character SHA. `ref` is the name the commit was taken from; a moved ref fails the build.
- **Adding a future release:** `npm run reconcile:releases` appends it automatically (see Release reconciliation). By hand, append a new server or library entry with a new id, its `ref`, and its full `commit`. Then update `defaults` if the new entry should become the default. Existing entries stay as they are.

### Publication

Library entries carry `publication`: evidence about what s&box published. It is independent of the GitHub source commit. A pinned source commit is never publication evidence.

- `status: "unverified"`: no publication evidence is recorded, so `revision` and `evidence` must be `null`. It never means published, certified, or compatible with any server.
- `status: "verified"`: `revision` is a numeric s&box revision string and `evidence` is an `https://` URL. The orchestrator rejects any other values.

Both current library snapshots are `unverified`. The catalog shows that status as "GitHub source; s&box publication unverified". A documentation pairing is not a compatibility certification.

To verify a published package, record the exact source commit used for publishing and the package revision assigned by s&box after publishing, with a durable HTTPS evidence link (release notes or a publication record). Confirm the installed package matches that source, excluding publication-generated metadata. Only then change that source entry to `verified`. Neither a matching SemVer nor the repository's `.version` file is sufficient: a stale revision file can remain through later source changes. Keep engine/server compatibility test evidence in the server's compatibility matrix; publication evidence alone does not certify a pairing.

### Tracking published revisions

`npm run track:revisions` queries the public s&box package API for `sboxcool.network-storage` and persists observations in `tools/docs/sbox-revisions.json`. The docs build copies these records to `/docs/sbox-revisions.json` and renders published revision history on `/docs/versions/#sbox-revisions`.

Endpoints are the ones used by the engine's `Package.FetchVersions` and `Package.FetchAsync`: `https://public.facepunch.com/sbox/package/versions/2/sboxcool.network-storage` returns revision history, and `https://public.facepunch.com/sbox/package/get/2/sboxcool.network-storage` reports the current `Version.Id`. Current must occur in history. Each recorded entry retains the API's `Id`, `Created`, `EngineVersion` and `ManifestUrl`; `AssetVersionId` must agree with `Id`. The API's `Hash` is not a source/content hash and can exceed JavaScript integer precision, so it is never used or persisted.

The engine's Library Manager writes `.version` on installation as `1.0.<revision>`. It is an installed-package marker, not a publishing receipt. The live API is the publication identity source.

The tracker retains old observations when the current package revision changes or rolls back. Re-observing the same metadata preserves the first-observed timestamp and does not rewrite history just to record another poll. API errors fail the refresh rather than recording an invented revision; the previous file remains intact.

Published-package tracking is separate from source mapping. An observed revision without a verified `libraries[].publication` mapping is displayed as unmapped and cannot silently select unrelated GitHub documentation. A verified mapping enables a source-docs link and adds the package revision to its library dropdown label.

### Pages and selectors

- Each server × library pair is archived at `/docs/versions/<server>/<library>/`. The unversioned `/docs/` pages are the default pair at their existing paths.
- Shared assets stay at the root for every pair: `/docs/docs.css`, `/docs/search.js` and `/docs/versions.js`. Search reads the index URL from the `data-index` attribute on `.docs-search`, so each pair searches its own index.
- The top of the docs navigation has two compact selects: `select#docs-version-server[data-doc-version="server"]` and `select#docs-version-library[data-doc-version="library"]`. Each option is the same page slug in another pair. Changing one select navigates to that option and keeps the `#hash`; the other axis and the page slug are kept. The same navigation DOM is used for the desktop sidebar and mobile docs menu, avoiding duplicate selector IDs. Publication/source details live below the article, not in a panel above it.
- If a selector's pair is built but lacks the slug, the option links to `/docs/versions/?missing=SLUG&server=SERVER_ID&library=LIBRARY_ID` (`SLUG` URL-encoded) and its label gets " (page unavailable)". The catalog then shows a text notice naming the page and pair. Another version's content is never shown in its place. The current pair always links to its own page, and the home page is never missing.
- If a selector's pair was not built at all, its option is disabled with the label "(not built)" and has no link.
- Without JS, `.docs-version-field` is hidden and the `<noscript>` list of `.docs-version-links` in the panel is the way to switch. Its links follow the same rule as the options: the same page where it exists, otherwise the catalog `?missing=` query. Every link is a plain static link.
- Historical content: pages absent from a historical snapshot are omitted, never replaced with today's content.
- `/docs/versions/` is the catalog. It lists every pair with its publication status and links to its `Read docs` page.
