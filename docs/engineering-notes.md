# Engineering notes

Internal context for maintainers. The user-facing documentation is the
[README](../README.md); this file is deliberately not part of it.

## Package shape

This repository root **is** the npm package. It ships as a harness **bundle with a
client channel**:

| File | Role |
|---|---|
| `package.json` | `dsh.bundle.patch` -> the composition layer; `dsh.client` (platform `web`) -> the browser module |
| `cordis.patch.yml` | One `insert` row (`id: timeline-diff`, `name: 'dsh-timeline-diff'`) |
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
- The rail reads two standard props of that slot, so they must stay declared for it:
  `useChat` (provided at session scope by `@deepseek-ai/dsh-client-ui-chat` through
  `uiSession.provide({ hooks: ["chat"] })`) and `useProjection` (`@deepseek-ai/dsh-client-ui-session`
  provides the keyed `projection` hook, whose values come from
  `binding.session.projections.faceOf(key)`). `dsh.client.inject` does **not** need
  either package: both arrive as slot props bound by the renderer's standard kit, not
  as services this module looks up.

## The turn navigator rail

The Chat tab's right-edge turn rail is `TurnNavigator`, private to
`@deepseek-ai/dsh-client-ui-chat` (that package's client entry exports only its
plugin), so the Diff view carries a port rather than an import. It is behaviourally
aligned on purpose: same 10 px pitch and 6 px end inset, same 12/18/20 px mark widths
and unloaded/preview/active/busy states, same pointer hit-testing by pitch, same
fades, and the same `>= 2 marks` and `prefers-reduced-motion` guards. Three
deliberate differences:

- **Loaded turns with no file change keep a dimmed mark** (`fd-rail-mark-nodiff`)
  and jump to the nearest section that did change. The view renders no header for a
  change-free turn, so a mark that aimed only at its own header would be dead.
- **The hover surface is a note card, not the shipped 100 px preview** — a full,
  scrollable answer. Details below.
- **Geometry does not use container query units.** The shipped rail's preview sizes
  itself in `cqw`; adding `container-type` to any ancestor of the sticky section
  headers is a needless risk to their pinning, so the card clamps with `vw` instead
  and the 900 px breakpoint is a media query.

Rail items are the merge of the loaded turn navigation index and the `turnOutline`
projection — the same two sources Chat merges, so the ladders match turn for turn,
including turns outside the loaded window (whose mark pages history in through the
turn's `turn/start` seq via the view's own `loadThrough` inject). A section is matched
to its Turn by `seq`: a section opens on a user node whose `seq` is after its turn's
`turn/start` seq, so the newest outline entry at or before the section's seq owns it.
The pinned sticky header *is* the active mark — the scroll sampler that already
computed the sticky offset now also reports that header's `data-fd-turn`.

The LLM's answer for a turn lives in the rail's **note card** — the answer surface
the Diff tab owns. Hovering or focusing a mark must not move the note out from under
the pointer, so two things differ from the shipped preview:

- **The card is interactive and flush to the frame.** `right: 100%` leaves no dead
  gap between a mark and the card (the shipped rail's `+10px` gap would fire
  `pointerleave` on the way across), and the card takes pointer events, so a long
  answer scrolls inside it (`overscroll-behavior: contain`, so the page does not
  move). Because the card is a descendant of the frame, `pointerleave` still fires
  when the pointer leaves both — that closes the note. Events that originate inside
  the card are filtered out of the rail's pointermove hit-test (`fromPreview`), or
  moving down the card would swap the note to whichever mark that y maps to, and
  clicking the card would navigate.
- **The answer is the full message, not a preview.** Text comes from the loaded
  window: the last text-bearing `assistant` node in the turn (`blocks`, text blocks
  only — reasoning is deliberately excluded, and a whitespace-only step does not
  overwrite a real answer). The outline's bounded `response` remains the fallback for
  turns outside the loaded window and for a turn whose answer is not finalized yet, and
  a turn with no text at all gets an explicit muted line rather than an empty card.

The card's height cap is `min(360px, band - 96px)`: bounded so a tall note cannot run
far past the composer area, and scrollable so a long answer is still fully readable.

### The Answer chip and its floating card

The rail note is the glance surface; the chip is the read-in-place one.

**The chip forced the header to stop being a single `<button>`.** A control inside that
button would be a nested interactive element — invalid HTML, and it breaks keyboard and
screen-reader behaviour — so the header is a `div.fd-section-user` holding:

- `div.fd-section-user-row`, whose own click handler keeps the whole row collapsing the
  section exactly as before (the inner prompt `<button>` has no handler of its own; its
  click, including the one Enter/Space synthesises, bubbles to the row);
- a real prompt `<button>` (`.fd-section-user-toggle`, carrying `aria-expanded`) plus a
  sibling `.fd-section-user-answer-toggle` chip that calls `stopPropagation`, so
  opening the answer never collapses the section;
- `.fd-section-answer`, the answer, as a **floating card**: `position: absolute` under
  the row (`top: calc(100% + 6px)`), spanning the right half of the message column
  (`left: 50%; right: 0`) so the prompt stays readable beside it, capped at
  `min(60vh, 560px)` with its own scroll, and set at the view's own 13px body size.

The card is deliberately **out of flow**. An earlier revision put the answer in the
header's flow, which meant the pinned header grew when it opened, which meant the sticky
offset its own file rows pin beneath had to be re-measured by hand (a `notifyLayoutChange`
seam through the memoized `Section`). Absolutely positioned children do not contribute to
`offsetHeight`, so the card costs nothing in layout and that coupling disappears — the
seam is kept only because it also covers the collapse toggle, which had the same latent
staleness before.

Three behaviours the card needs to not be a nuisance:

- **Dismissal** — the chip, `Escape`, or a capture-phase `pointerdown` outside the
  header. All three close it.
- **Active-message gating** — `answerOpen` also requires the section to be the active
  turn, reusing the same sampler that drives the rail's active mark. Without it, an open
  card would keep hovering over the *next* message's diffs while its own header sits
  covered behind the next header. An unknown active turn (nothing measured yet) is
  treated as "allow" so the chip can never appear dead.
- **A z-index lift** — `.fd-section-answer-open` raises the open section to `z-index: 5`,
  because sibling headers share `z-index: 3` and DOM order would otherwise paint a later
  header over the card during the handover.

When the text is the host's bounded outline preview rather than the turn's own message,
the card says so (`Answer (preview)`) and offers **Load this message**, which pages the
turn in through the same `turn/start` seq the rail's unloaded marks use. After that the
card shows the real message and the action disappears.

### The assistant block discriminator is `kind`, not `type`

Worth stating plainly because it silently broke this feature once. The core LLM content
blocks are `type`-tagged, and the Chat target converts them for assistant nodes:
`toAssistantBlock` maps `{type:'text'}` to `{kind:'text'}`. So a user node's `content`
uses `type`, while an assistant node's `blocks` use `kind` — same word, different field,
and the two appear in the very same array of legacy nodes.

An extractor matching `block.type === 'text'` therefore found nothing in a real session,
every turn's answer came out empty, and both the note and the chip quietly fell back to
the host's outline preview — a one-line teaser that looked like a styling problem and was
actually missing data. `assistantText` now accepts both discriminators. The lesson for
the tests is in the same vein: the first fixture used `type` because it was written from
the wrong type definition, so the suite confirmed the bug instead of catching it. Fixtures
for harness shapes are now taken from the harness's own declarations (`AssistantBlock` in
`dsh-client-ui-conversation`), not from a plausible-looking guess.

### Rendering the answer as Markdown

The answer is rendered with the harness's own `MarkdownText`
(`@deepseek-ai/dsh-client-ui-primitives`) — the same GFM+KaTeX renderer the Chat tab
gives assistant text, so an answer looks the same in both places.

It is reachable from a plugin for free. The web shell builds the client module system
with a **static module table**, read out of the shell bundle:

```
react, react/jsx-runtime, react-dom, react-dom/client, @deepseek-ai/cordis,
@deepseek-ai/dsh-client-store, @deepseek-ai/dsh-client-ui-slots,
@deepseek-ai/dsh-client-ui-primitives, @deepseek-ai/dsh-client-ui-dockkit
```

A static-table name `require(...)`s exactly like `react` does: no dependency, no
`dsh.client.external` entry, no module-graph edge. That matters for this package, whose
whole distribution story is "empty dependency fields, one committed bundle" — a real
dependency would have meant `ERESOLVE` at install time and a hard baseline pin.

The require is wrapped in a guard. If a harness drops the entry, or in the legacy
dynamic payload where `require` does not exist at all, `MarkdownText` stays `null` and
`AnswerText` renders the message as pre-wrapped plain text instead. Degrading a card is
acceptable; failing the view is not.

`MarkdownText` is **not** usable with `text` alone. Its chrome labels are read without a
guard, from the render context the Chat tab fills in with `markdownLabels(t)`:

```js
// client/ui-chat — and the shell's own markdown element renderers
{ code: { copyLabel, copiedLabel }, footnotes }
```

The fenced-code element renders

```js
d.jsx(CodeBlock, { code, lang, streaming, copyLabel: i.labels.code.copyLabel, copiedLabel: i.labels.code.copiedLabel })
```

so a single fenced block in an answer — with or without a language — throws
`Cannot read properties of undefined (reading 'code')` when `labels` is omitted, and
the footnote heading reads `labels.footnotes` the same way. That is exactly what
happened: the first answer card opened in a browser blanked the tab, because React
unmounts the tree on an uncaught render error. The plugin now ships the same
`MARKDOWN_LABELS` object, and `AnswerText` wraps the renderer in `MarkdownBoundary` —
a one-method error boundary — so a renderer that throws anyway degrades to the plain
text instead of the tab the way the no-renderer arm already did. The boundary is keyed
by `text`, so a message paged in later retries Markdown after an earlier preview failed.

Two notes for whoever touches this next:

- The primitives' Markdown renderer emits semantic elements with almost no class names
  (its spacing lives in the harness's chat containers, which do not apply here), so the
  plugin carries a small `.fd-answer-markdown` block for `p`/`ul`/`pre`/`code`/table
  spacing of its own.
- It is the same component in both surfaces — the header card and the rail note — so a
  change to one answer's rendering is a change to both.

### Highlighting the diff with the sidebar's own code surface

The sidebar's file preview highlights code in `CodeBody`
(`@deepseek-ai/dsh-client-ui-sidebar-documentpreview`), which renders
`ui-primitives`' `CodeBlock` — Shiki, with each grammar fetched lazily by the
primitive itself. `CodeBlock` comes from the **same static module table** as
`MarkdownText`, so the Diff tab reaches the identical component and a line of code
carries the same colors in both places. The suffix → grammar table is
documentpreview's own `languageForPath`, replicated because it is not exported:
without it `CodeBlock` would be handed `js`/`ts`/`py` and other spellings it does
not accept.

Shiki highlights a document, not a line, so the unit here is the **patch run**:
`rowGroups` collects consecutive rows of one kind (the context block, the
deletions, the insertions) and each run becomes one `CodeBlock`. That keeps
multi-line constructs inside a run in context and keeps the instance count near the
hunk count instead of the line count. The trade-off — a construct that straddles a
run boundary is tokenized in two pieces — is stated in the README.

Three details make the diff backgrounds possible at all:

- `lineNumbers` is passed **not for numbers but for the layout it selects**. The
  primitive's numbered CSS turns `pre code > .line` into a block (`display: block`,
  `white-space: var(--dsl-code-block-line-white-space, pre-wrap)`), which drops the
  newline text nodes between the line spans. Without that, a per-line background
  could not be painted and there would be no `::before` gutter to hold a sign.
  `--dsl-code-block-line-number-width` is set inline by the primitive from the run
  length, so the gutter widens with the run; the plugin stylesheet replaces only the
  `::before` content (a `+`/`-` in the diff's own colors) and the line background.
- The banner (`data-code-block-banner`: grammar name + copy) is hidden, and the
  block's background, border radius, and margins are reset through the
  `--dsl-code-block-*` custom properties **on the block element itself** — the
  primitive declares those on the block, so setting them on an ancestor would be
  overridden.
- The plugin's `<style>` is appended to `head` after the shell's stylesheet, so an
  equal-specificity selector here would already win; the `.fd-code` selectors are
  written at higher specificity anyway, so the override does not rest on load order.

Degradation has the same shape as Markdown: no `CodeBlock`, or no grammar for the
suffix, and `plainRow` renders exactly the rows the view drew before highlighting
existed, signs and tints included. The dynamic payload has no `require`, so it
always takes that path — the guarded lookup is mirrored there anyway, which is what
keeps `port-from-dynamic.mjs` byte-exact. The mapping and the run grouping live in
the `__fd-code-begin/end` block, which `scripts/check-client.mjs` slices out and
exercises with a stub React and a stub `CodeBlock`.

### Degradation

`useChat`, `useProjection`, and `loadThrough` are each optional at runtime. Without
the projection the rail still renders the loaded turns (sections fall back to being
aligned with loaded turns in order); without `loadThrough` an unloaded mark scrolls
to the nearest loaded section instead of paging; without both the rail is simply
absent from the body, and the view renders exactly as before.

### Keeping the two payloads in sync

`src/client.js` and `dynamic/plugin-client.js` are the same view layer with five
shell differences (see `scripts/port-from-dynamic.mjs`). After editing `src/client.js`,
regenerate the dynamic half by reversing those five transformations, then prove it by
re-running the forward port and diffing the result against `src/client.js` — it must
reproduce the file byte for byte. That round-trip is what the rail mirror was
verified with.

### Scroller detection must re-run after layout

The view grows with its content, so `.fd-scroll` must stay `overflow: visible` and
sticky children must bind to the session body's scrollport. The ancestor walk that
finds that scrollport therefore runs **more than once**: on mount, on the next two
animation frames, after a 100 ms settle, and from a `ResizeObserver`. A one-shot walk
is not safe — on first mount the conversation nodes (and so the Files content) can
still be arriving, the walk finds no scrollable ancestor, and the fallback sets
`.fd-scroll { overflow: auto }`. That box grows with its content instead of scrolling,
so `position: sticky` pins against a scrollport that never moves and every sticky
header silently disappears. Re-detecting lets the view switch back to `visible` and
rebind the scroll listener once the real scrollport is measurable.

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
2. `dsh --profile web --dump-config` -> composes a `# == dsh-timeline-diff`
   layer with the expected row.
3. `dsh --profile web --help` -> the whole plugin tree boots, exit 0, no
   `plugin tree failed to load`.
4. Isolated boot on a scratch port -> the client module appears in `__DSH_BOOT__`
   (`{"id":"dsh-timeline-diff","url":"/plugins/??dsh-timeline-diff/client.js…"}`
   with the expected `inject`) and `/plugins/??dsh-timeline-diff/client.js`
   returns HTTP 200 with the expected bundle body.
5. Factory smoke test: evaluating the bundle registers the id and the factory returns
   `{ name, inject, apply }`.
6. **Negative control**: a copy declaring `dsh.client` with `exports["./client"]`
   removed fails the boot loudly —
   `client-modules: dsh-timeline-diff declares dsh.client but exports no "./client" bundle`, exit 1.
7. **Rail render check** (added with the rail): load the built bundle through its
   `window.__ModuleLoader__.load` entry, call `apply()` against a stub ctx, then render
   the registered `conversation.view` component with `react-dom/server` and stub slot
   hooks. Asserts the rail frame, one mark per turn, loaded/unloaded/diff-less mark
   classes, `data-fd-turn` on section headers, the aria labels, and that the view still
   renders with the projection missing (the fallback arm). Effects do not run under
   server rendering, so this covers composition and the item/ladder derivation, not
   scroll behaviour.
8. **Note-card check**: extract the `__fd-core-begin/end` block and unit-test
   `assistantText`/`buildModel` — the answer is the last text-bearing assistant message,
   **read through the real `AssistantBlock` shape (`kind`)**, with the core `type` shape
   still tolerated as a fallback, reasoning excluded, and a whitespace-only step not
   erasing a real answer. Then mount the view under jsdom with stubbed hooks, dispatch a
   `pointermove` onto a mark, and assert the note opens with the **full** multi-line
   answer (proving it is not the outline's preview), the changed file list, and the
   outline fallback for an unloaded turn.
9. **Answer-card check**: mount under jsdom with `getBoundingClientRect` stubbed so the
   active-Turn sampler sees a real stacking order. Asserts the header is a `div` with
   exactly two sibling buttons (no nesting), the chip starts collapsed with the answer
   absent, the card opens with the **whole** answer while the diff rows stay in the DOM,
   the card sits out of the row's flow, the open section lifts above later siblings, the
   chip's click does not collapse the section while the row's click still does, and the
   card closes on `Escape`, on an outside `pointerdown`, and automatically once another
   message becomes the active one.
10. **Preview/load check**: mount a window that opens mid-turn (no prompt, no answer
    locally) and assert the card is labelled `Answer (preview)`, offers **Load this
    message**, and that clicking it pages through the outline entry's `turn/start` seq
    (`loadThrough(4)` in the fixture) without closing the card.
11. **Markdown check**: boot the bundle twice against different static-module tables —
    one exposing `ui-primitives`, one not. With it, the card and the rail note both render
    through `MarkdownText` with the raw message text and the `.fd-answer-markdown` block
    class; without it, the same text survives as pre-wrapped plain text
    (`.fd-answer-plain`) with no markdown wrapper. The same suite asserts the card's
    geometry (right half, `min(60vh, 560px)`) and that the chip reads **Answer**.
12. The dynamic-payload mirror is verified by round-trip: reverse the five port
    transformations into `dynamic/plugin-client.js`, re-run `port-from-dynamic.mjs`, and
    require it to reproduce `src/client.js` byte for byte.
13. **Highlight check** (added with the highlighted rows): `scripts/check-client.mjs`
    slices the `__fd-code-begin/end` block out of `src/client.js` and exercises it with a
    stub React and a stub `CodeBlock` — the suffix map (including a Windows path, an
    uppercase suffix, an extensionless file, and a dotfile), run grouping, and the
    rendered tree: one `CodeBlock` per same-kind run with the run's lines joined, the
    right grammar, `lineNumbers` on, and the plain-row fallback both for an unknown
    suffix and with the primitive missing entirely. The same run loads the committed
    `lib/client.js` through its real `window.__ModuleLoader__.load` envelope and the
    legacy dynamic payload through an evaluator body, asserting both still register the
    view (and that the dynamic scope really has no `require`, so the guarded lookup takes
    the fallback).
14. **Answer-label check** (added with the fix for the blanking tab): the same script
    slices the `__fd-answer-begin/end` block and asserts that `AnswerText` hands the
    renderer all three labels it reads without a guard (`code.copyLabel`,
    `code.copiedLabel`, `footnotes`), that the renderer sits inside `MarkdownBoundary`,
    that the boundary renders its children when healthy and its plain-text fallback once
    `failed`, and that the no-renderer arm still returns the raw text. The failure this
    covers was found in a browser, not here: the offline Markdown check in item 11 used a
    stub renderer, which is exactly why a missing `labels` object survived it.

Not yet performed: a real browser interaction — mounting the tab, scrolling the rail,
jumping to an unloaded turn, carrying the pointer from a mark onto the note card, and
confirming that a floating card really does sit over the diffs without clipping or
disturbing the pinned file rows. The highlighted rows add one more of the same kind:
the per-line diff backgrounds and the `+`/`-` `::before` signs depend on the
primitive's numbered layout and on the shell stylesheet's `.line` rule, which jsdom
would not model either. This gap is not theoretical — the first real browser pass over
the Answer card is what found the missing `labels` object (item 14), after the
stub-renderer check in item 11 had passed. jsdom reports zero heights, so layout
questions there are logic-verified only. That is the last acceptance step after a
reload.

Rebuilds reach a **running** server without a restart: `@deepseek-ai/dsh-client-hmr`
stat-polls every graph row's client bundle (500 ms) and hot-swaps the module in the
browser over its `/plugins/events` SSE channel. The boot-time bundle-layer composition
warning in the README applies to *installing* a new plugin, not to editing one already
in the graph.

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
