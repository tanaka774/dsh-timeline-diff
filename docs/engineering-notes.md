# Engineering notes

Internal context for maintainers. The user-facing documentation is the
[README](../README.md); this file is deliberately not part of it.

## Package shape

This repository root **is** the npm package. It ships as a harness **bundle with a
client channel**:

| File | Role |
|---|---|
| `package.json` | `dsh.bundle.patch` -> the composition layer; `dsh.client` (platform `web`) -> the browser module |
| `cordis.patch.yml` | One `insert` row (`id: chat-timeline-diff`, `name: 'dsh-chat-timeline-diff'`) |
| `index.js` | Host entry. Deliberately a no-op: the client module system discovers a package's `dsh.client` declaration from the host Loader entry, so the row is what makes the browser half load |
| `src/client.js` | Client module source (CommonJS; `module.exports` is the Cordis plugin) |
| `lib/client.js` | Built client bundle, wrapped in `window.__ModuleLoader__.load({ id, factory })`. **Committed on purpose** |
| `scripts/build-client.mjs` | `src/client.js` -> `lib/client.js` |
| `scripts/port-from-dynamic.mjs` | Re-derives `src/client.js` from the legacy `dynamic/plugin-client.js` |
| `dynamic/` | The original dynamic-plugin payloads, kept for the no-install path |

### Why the host entry is a no-op

The client module registry scans **host Loader entries** for packages declaring
`dsh.client` (`ClientModuleRegistry.resolveSource` -> `locatePkgJson` ->
`parseDshClient`). A bundle row is therefore mandatory even though all behavior is in
the browser half. Keeping the host entry dependency-free and injection-free means it
can never keep the profile from booting.

### Client module ordering fields

`dsh.client.inject` lists the packages whose client services this module consumes;
the browser half registers each before its consumer:

```
@deepseek-ai/dsh-client-ui-renderer   ->  slots
@deepseek-ai/dsh-api-session-controller -> sessions
@deepseek-ai/dsh-api-gateway          -> remote, remote.workspaceFiles
```

`dsh.client.external` (module-graph edges for `require(...)`d packages) is not needed:
the only `require` is `react`, which is a static-table name.

## Transport decision: reuse `remote.workspaceFiles`

The dynamic payload shipped a custom host half with one RPC (`fd.readFile`) over the
host `fs` service. The package **drops it**: the web profile already mounts
`@deepseek-ai/dsh-api-workspace-files`, which exposes the session-scoped
`workspaceFiles` Remote namespace:

- `readAll(sessionId, path) -> RemoteResult<WorkspaceFileBytes>` — the complete file
  as base64, `eof: true`, capped by `maxFileBytes` (default 32 MiB), with
  `WorkspaceFileStat.bytes` for a size check.

The client decodes base64 to UTF-8 and treats a NUL byte as "not text", mirroring the
old `fs.readText` refusal. This keeps the file read inside the harness's own
sandbox-bounded API instead of a bespoke host RPC, and works for any session because
the scope id is the `sessionId` the view already receives.

`RemoteResult<T>` is `{ ok: true, value } | { ok: false, error }`; business failures
arrive in the error branch, so a rejected promise is only an assembly fault.

## Baseline and API coupling

Verified against **`dsh 0.1.5-rc.2`** (`dsh --version`). Service names and slot props
drift between rcs; re-verify on every baseline bump:

- `slots` is provided by `@deepseek-ai/dsh-client-ui-renderer`
  (`super(ctx, "slots")`), not by a package named `dsh-client-ui-slots` (which does
  not exist at this baseline).
- `sessions` is provided by `@deepseek-ai/dsh-api-session-controller`
  (`rootCtx.reflect.provide("sessions", ...)`).
- The `conversation.view` slot API used here is `slots.inject(key, cb)` +
  `slots.register(options, component)`.

## Dependencies are intentionally empty

`dependencies`, `peerDependencies`, and `devDependencies` are all absent. The
`@deepseek-ai/*` packages and `cordis` are injected by the profile's pnpm closure at
mount time; declaring them makes installs fail with `ERESOLVE` and hard-couples the
plugin to a baseline. The build needs no `@deepseek-ai/*` import, so no local SDK link
is required.

## Distribution: git source with committed artifacts

Commit `lib/client.js`. A git install fetches sources, not build output, and pnpm
>= 10 refuses to run a dependency's `prepare` script without an explicit
`allowBuilds` grant. Committing the artifact makes the install a true one-liner and
asks the user for no install-time code execution. No `prepare` script is defined.

## Verification performed

Against `dsh 0.1.5-rc.2`, on an **isolated** `$DSH_HOME` (the live profile was left
untouched):

1. `dsh plugin --profile web add <path>` -> the dependency and the bundle layer are
   registered in `dsh.profile.bundles`.
2. `dsh --profile web --dump-config` -> composes a `# == dsh-chat-timeline-diff`
   layer with the expected row.
3. `dsh --profile web --help` -> the whole plugin tree boots, exit 0, no
   `plugin tree failed to load`.
4. Isolated boot on a scratch port -> the client module appears in `__DSH_BOOT__`
   (`{"id":"dsh-chat-timeline-diff","url":"/plugins/??dsh-chat-timeline-diff/client.js…"}`
   with the expected `inject`) and `/plugins/??dsh-chat-timeline-diff/client.js`
   returns HTTP 200 with the expected bundle body.
5. Factory smoke test: evaluating the bundle registers the id and the factory returns
   `{ name, inject, apply }`.
6. **Negative control**: a copy declaring `dsh.client` with `exports["./client"]`
   removed fails the boot loudly —
   `client-modules: dsh-chat-timeline-diff declares dsh.client but exports no "./client" bundle`, exit 1.

Not yet performed: a real browser interaction (mount the tab, render a diff, click
through Timeline/File). That needs a human at the UI and is the last acceptance step
after a restart.

## Publishing checklist

- [x] `dsh.bundle.patch` insert row and package name agree
- [x] dependency fields empty
- [x] build artifact committed; no `prepare` script
- [x] `exports["./package.json"]` present (the client-module scanner's fallback path
      resolves it)
- [x] clean boot and a passing negative control
- [ ] README screenshot of the Files tab (`docs/preview/`) — TODO
- [ ] repository description = one line, no install commands — TODO
- [ ] repository topics include `dsh-plugin` and `deepseek-harness` plus 1-3 feature
      words — TODO
- [ ] announcement post in the official Discussions `Show Your Plugins!` category —
      TODO, public action, needs explicit consent
