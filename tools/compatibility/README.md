# Compatibility automation

Shared, trusted tooling for `sbox-cool/sbox-network-storage`. The library workflows pin this repository by immutable commit. The server's maintainer-protected workflows are intentionally unchanged; the library monitor still tracks unvalidated server/package pairs.

## Automatic issues

`monitor-builds.mjs` reuses the existing GitHub/sbox publication reconcilers and reads the reviewed validation history from the docs repository's main branch. It emits stable-key findings for:

- The current library source head missing complete `game/sqlite`, `game/postgres`, or `editor/sqlite` evidence.
- The newest stable server commit/current sbox package revision missing complete published-package `game/sqlite` or `game/postgres` evidence.

The library workflow runs this every 15 scheduled minutes, on pushes to main, and on demand. GitHub schedules can be delayed. No cross-repository secret is needed: GitHub/server/package reads are public, and issues are written in the workflow's own library repository.

```sh
node tools/compatibility/monitor-builds.mjs --output /tmp/findings.json --use-gh-auth
node tools/compatibility/sync-issues.mjs --repo sbox-cool/sbox-network-storage --findings /tmp/findings.json --dry-run --use-gh-auth
# Use --apply instead of --dry-run to reconcile the issues.
```

`GH_TOKEN`/`GITHUB_TOKEN` is used in Actions. `--use-gh-auth` explicitly uses the current local gh login without storing or printing the token. Even dry-run issue planning needs an authenticated fresh issue read.

Owned issues have the `compatibility-automation` label and a keyed managed section. Repeated findings update/reopen that issue rather than creating another; human notes outside the managed section and human labels are preserved. A missing finding never closes an old issue. Only an explicit inactive finding with matching evidence resolves an owned issue. Closing an active issue does not certify it and it will reopen. Do not remove the ownership label/markers if the automation should continue managing the issue.

Issue listing uses authenticated GraphQL POSTs over the repository issue connection, not cached REST/search/label-filtered reads. The initial live smoke exposed GitHub's 60-second REST list-cache read-after-write problem; duplicate smoke issues were closed and detached from management. Workflows serialize reconciliation to prevent concurrent creators. Truncated pagination, duplicate owned keys and malformed managed sections fail closed.

## PR check

The trusted `pull_request_target` workflow never executes the PR checkout, its scripts, or its MSBuild projects. It materializes C# blobs as plain files and parses them using the pinned Roslyn tool in this repository. It also reruns on PR edits/synchronization, maintainer review comments and completed trusted native workflows.

- Removed/changed existing public declarations fail, including parameter names/defaults, return types, attributes, generics/constraints, property accessors, enum values/order, base types and exposed nested declarations.
- New public APIs and meaningful runtime/editor changes are flagged, not automatically declared safe. Private helper, using, string-literal and conditional-compilation changes remain significant even when public signatures are unchanged.
- Whitespace/comments-only changes and documentation/assets-only PRs can pass without native testing.
- Generated compiled package/archive changes are blocked: source-recompiled tests cannot establish package-loading compatibility.
- Meaningful source changes require a canonical classification, an exact-head maintainer acknowledgement, and complete native evidence for the changed runtime/editor surface. Runtime evidence cannot stand in for editor evidence.

The analyzer inspects all combinations of up to six conditional symbols. Syntax errors/unsupported syntax and larger conditional spaces fail closed. It is a conservative syntax-contract check, not a semantic theorem: equivalent spelling/refactoring can still be flagged, and arbitrary behavioral compatibility cannot be proven from a diff. Preserve existing contracts rather than treating a green check as permission to silently change them.

A maintainer with write/maintain/admin access acknowledges the exact head in a PR comment:

```text
/compatibility-review FULL_40_CHARACTER_HEAD_SHA library-code
```

Classes are `none`, `additive-default-off`, `changed`, `library-code`. Select the corresponding checkbox in the PR template. Comments from read-only users/bots and comments for old commits do not count. Meaningful library changes cannot self-declare `none`. An acknowledgement never overrides a removed public contract or missing native evidence.

Native evidence is accepted only from the exact-head successful native/editor workflow on the trusted default branch (matching repository, workflow path, event and run title), or a reviewed canonical full-coverage record for that exact source head/mode. A pending/failed native check cannot fall back to an older canonical pass. PR bodies, arbitrary success statuses, another head, HTTP-only runs and partial method coverage are not evidence.

```sh
# Reads PR code as data; does not execute its builds.
PATH="$DOTNET_10_BIN:$PATH" node tools/compatibility/check-pr.mjs \
  --repo sbox-cool/sbox-network-storage --pr NUMBER --git /path/to/library-checkout \
  --output /tmp/pr-compatibility --use-gh-auth
# --apply-status posts the actual result to the PR's exact head.
```

Required SDK: .NET 10.0.100. Contract regressions: `dotnet run --project tools/compatibility/ContractInspector -- --self-test`. Policy/issue/evidence regressions: `node --test tools/compatibility/*.test.mjs`.

## Native candidate workflow

The manual native workflow requires an approved `sbox-native` runner, `SBOX_GAME`, `SBOX_CERTIFICATION_RUNNER_ENABLED=true`, an exact-head maintainer acknowledgement and an open same-repository PR. Fork code is never executed on a persistent runner. The reviewed candidate must be trusted before executing it; do not give an untrusted PR access to the runner.

It tests the actual current published runtime sources as the baseline and the exact PR Git source as the candidate against the selected stable server source. Both complete method-inventory gates must pass. Candidate provenance is `github-source`, with a Git commit and no invented sbox package revision. Its `manifestSha256` fingerprints the materialized runtime source manifest, not a published package manifest. The existing native harness currently covers only a subset, so incomplete coverage deliberately fails this workflow until the missing behavioral cases are implemented. Headless/source-recompiled results do not certify editor UI, real player auth, PostgreSQL, signed release binaries or published code-archive loading.

The native job has no status-writing token. A separate hosted job posts the result; the PR gate verifies the completed trusted run rather than trusting a PR-supplied status link. Editor changes require an actual editor run/canonical editor record, not this headless harness.

## Merge protection

The status context is `Network Storage / compatibility`. Make it required with up-to-date branches after installing the trusted workflow. A visible failing check alone does not block merges/direct pushes on an unprotected branch. The repository was unprotected when this work began; do not describe advisory checks as enforced merge protection. Keep workflow/policy changes subject to maintainer review. The server workflows remain maintainer-owned and require their owner's explicit cutover before installing a server-side equivalent.
