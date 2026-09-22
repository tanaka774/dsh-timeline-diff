<h1 align="center">Chat Timeline File Diff Viewer</h1>

<p align="center">
  A <b>Files</b> tab for the DeepSeek Harness web UI that shows every file change in a
  session as diffs, grouped under the message that caused it.<br>
  <a href="LICENSE"><img alt="license" src="https://badgen.net/badge/license/MIT/blue"></a>
</p>

The feature is simple, you can see each file change per your conversation on your "Files" tab.

<img width="1311" height="851" alt="image" src="https://github.com/user-attachments/assets/bb7d7938-4664-4679-be91-195af7e720b4" />

## Motivation

- I wanted a diff viewer as pure history of each change, which is unrelated to git or other tools.
- I thought it would be useful in case of confirming what the previous session did if you can see each of those changes. 

## Install

```
dsh plugin --profile web add "github:tanaka774/dsh-timeline-files-diff-plugin"
```

------

The following is the llm's gentle explanation.

------

## What it is

DeepSeek Harness already renders a diff on each `write`/`edit` tool card. What it
does not give you is the session-wide picture: *which files did this conversation
touch, and what is the total change to each of them?* This plugin adds a **Files**
view alongside Chat and Trajectory that answers exactly that, in two modes:

- **Timeline** — change entries grouped under the user message that prompted them.
  Each file changed more than once inside one message also gets a `Σ path` row: one
  aggregated diff for that message's window, with `+a −b` counts.
- **File** — one cumulative diff per file across the whole session (conversation
  start → session end), with the individual changes available behind a toggle.

Created files are marked `new file`. Sticky headers keep the current message and
file name visible while you scroll a long diff.

## Why you'd want it

Without it, answering "what did this session actually change?" means scrolling the
whole transcript and mentally joining dozens of per-call diff cards — and for a file
edited five times, the per-call cards never show the net result. This tab answers it
in one screen, scoped to the session you are looking at.

## Install

Requires a DeepSeek Harness `web` profile (`dsh 0.1.5-rc.2` or a compatible rc).

```sh
dsh plugin --profile web add "github:tanaka774/dsh-timeline-files-diff-plugin"
```

Then **restart `dsh web`** — bundle layers compose at boot, so a running server will
not pick the plugin up until it restarts. After the restart, open any session and
pick the **Files** tab in the header (rightmost, after Chat and Trajectory).

Pin a commit if you want reproducible installs:

```sh
dsh plugin --profile web add "github:tanaka774/dsh-timeline-files-diff-plugin#<commit>"
```

Build output is committed to this repository, so the install needs **no build step
and asks for no `allowBuilds` permission**. To uninstall:

```sh
dsh plugin --profile web remove dsh-chat-timeline-diff
```

<details>
<summary>No-install (dynamic) alternative</summary>

The original delivery form still works for a single running harness process and
needs no package install: send your agent the two payloads under
[`dynamic/`](dynamic/) (`plugin-host.js` as `code.host`, `plugin-client.js` as
`code.client`) and it will `cordis_define` + `cordis_run` them. That form is
process-local: it is gone after a restart, and it uses a small custom read RPC
instead of the harness's own workspace file API. The installed package is the
supported form.
</details>

## Capabilities

| Surface | What it adds |
|---|---|
| `conversation.view` slot | A **Files** tab in the session header, with Timeline and File modes |
| Per-message aggregation | `Σ path` rows: one diff per file per message window, with `+a −b` |
| Session-cumulative diffs | One diff per file from conversation start to session end |
| Sticky headers | The current message card and file name stay pinned while scrolling |

## How the cumulative diffs stay honest

The session log persists, per `write`/`edit` call, only **contextual hunks** (the
changed region ± 3 context lines) — never a full "before" snapshot of a file that
already existed. The plugin therefore reconstructs file states instead of trusting a
stored history:

- a file **created in the session** is walked forward from its first full content;
- a **pre-existing file** is walked backward: the plugin reads the file's current
  on-disk content through the harness's own session-scoped workspace file API, then
  *undoes* every recorded hunk in reverse order (each step must match exactly once).

Every step is validated. If any step fails, that file falls back to the plain
per-change display with a one-line reason. The view never shows data it could not
verify.

## Known limitations

- **Cumulative diffs anchor on the current workspace.** Backward reconstruction needs
  the file's current on-disk content to be the session's end state. If the file was
  changed afterwards by another session or by hand, that file falls back to the
  per-change display rather than showing a wrong total.
- **Deletions are not tracked** in the session's diff metadata, so a file deleted (or
  deleted and recreated) at the end of a session can only be partially reconstructed
  and falls back to per-change display.
- **Very large files are skipped** for cumulative diffs and shown per-change.
- **API coupling.** The plugin targets the harness client and Remote APIs of
  `dsh 0.1.5-rc.2`. A harness update that changes slot props, service names, or the
  `workspaceFiles` Remote namespace can require a matching plugin update.

## Development

```sh
node scripts/build-client.mjs      # src/client.js -> lib/client.js (the dsh.client bundle)
node scripts/port-from-dynamic.mjs # re-derive src/client.js from the legacy payload
```

`lib/client.js` is a build artifact and is committed; edit `src/client.js`, then
rebuild. See [`docs/engineering-notes.md`](docs/engineering-notes.md) for the package
architecture, the transport decision, and the verification evidence.

## License

[MIT](LICENSE) — Copyright (c) 2026 tanaka. You may use, copy, modify, and
redistribute this plugin (and its derivatives) under the terms of the MIT license;
see [`LICENSE`](LICENSE) for details.
