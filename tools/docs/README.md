# Docs generator

`/docs/` on sboxns.com is generated, not hand-written. Edit the sources instead:

| Pages | Source |
| --- | --- |
| Guides (connect a game, self-hosting, configuration, ...) | `docs/*.md` in sbox-cool/sbox-network-storage-server |
| Library guides | `README.md`, `source-authoring.md`, `Examples/README.md`, `docs/*.md` in sbox-cool/sbox-network-storage |
| HTTP API reference | Route definitions in the server's `src/SboxNetworkStorage.Server/Endpoints/`, checked against `tests/parity/corpus/` |
| C# API reference | Public types and `///` comments under the library's `Code/` |

The page list and navigation live in `build.mjs` (`PAGES`, `SECTIONS`).

## Regenerate

```sh
cd tools/docs
npm ci
node build.mjs                      # server: newest vX.Y.Z tag, library: main
node build.mjs --server-ref v0.5.3 --library-ref main
node check-links.mjs                # fails on any broken internal link or anchor
```

The build fails when a request in the server's HTTP contract tests has no matching route, so the
API reference cannot silently drift from the server. It also rewrites `sitemap.xml` and `llms.txt`.

The **Regenerate docs** workflow runs daily and on demand, and opens a pull request when the
output changes. Commit the generated `docs/` folder; GitHub Pages serves it as static files.
