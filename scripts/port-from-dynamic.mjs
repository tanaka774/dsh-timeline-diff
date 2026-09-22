// Port the legacy dynamic-plugin client payload (`dynamic/plugin-client.js`)
// into the real `dsh.client` module source (`src/client.js`).
//
// The pure diff engine is copied verbatim. Only the shell changes:
//   * the dynamic evaluator globals (`React`, `styles`, `host`) become a real
//     `require('react')`, an injected `<style>` element, and the harness's own
//     session-scoped `remote.workspaceFiles` Remote namespace;
//   * the returned plugin object becomes `module.exports`, which the build step
//     wraps in `window.__ModuleLoader__.load({ id, factory })`.
//
// Every replacement asserts its anchor matched, so a drifting dynamic payload
// fails loudly instead of silently producing a wrong bundle.
//
// Usage: node scripts/port-from-dynamic.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'dynamic', 'plugin-client.js')
const to = join(root, 'src', 'client.js')

const HEADER = [
  '// Chat Timeline File Diff Viewer — client module source.',
  '//',
  '// This is the `dsh.client` half of the package: a plain CommonJS module whose',
  '// exports the client module runtime mounts as a Cordis plugin. The build step',
  '// (`scripts/build-client.mjs`) wraps this file in',
  '// `window.__ModuleLoader__.load({ id, factory })` to produce `lib/client.js`.',
  '//',
  '// On-disk content is read through the harness\'s own `remote.workspaceFiles`',
  '// Remote namespace (session-scoped, sandbox-bounded). This package ships no',
  '// custom host RPC.',
  '//',
  '// Data model note: the persisted session log carries, per write/edit call, only',
  '// contextual hunks (changed region +/- 3 context lines) — never the full "before"',
  '// content of a file that already existed. Cumulative per-file diffs are therefore',
  '// reconstructed: the current on-disk content is walked BACKWARD by undoing every',
  '// recorded hunk (each step must match exactly once), which yields the content at',
  '// any earlier point of the conversation; created files are walked FORWARD from',
  '// their first full content. Any failed step makes that file fall back to the',
  '// plain per-change rendering — never wrong data.',
  '',
  "const React = require('react')",
  '',
  '/** Decode a base64 byte payload from the workspaceFiles Remote into UTF-8 text. */',
  'const b64ToText = (data) => {',
  '  const binary = atob(data)',
  '  const bytes = new Uint8Array(binary.length)',
  '  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)',
  "  return new TextDecoder('utf-8').decode(bytes)",
  '}',
  '',
  '/**',
  ' * Read one complete file\'s current content through the session-scoped',
  ' * workspaceFiles Remote. Returns null when the file is absent, unreadable,',
  ' * outside the session workspace, binary (NUL), or otherwise unavailable, so the',
  ' * caller falls back to per-change rendering.',
  ' */',
  'const readWorkspaceFile = async (remote, sessionId, path) => {',
  '  if (remote === undefined || remote === null) return null',
  '  try {',
  '    const result = await remote.readAll(sessionId, path)',
  "    if (result === null || typeof result !== 'object' || result.ok !== true) return null",
  '    const value = result.value',
  "    if (value === null || typeof value !== 'object' || typeof value.data !== 'string') return null",
  '    const text = b64ToText(value.data)',
  "    return text.indexOf('\\u0000') === -1 ? text : null",
  '  } catch (error) {',
  '    return null',
  '  }',
  '}',
  '',
  '',
].join('\n')

let src = readFileSync(from, 'utf8')

const cssAt = src.indexOf('const CSS = ')
if (cssAt < 0) throw new Error('port: could not find the CSS anchor')
let out = HEADER + src.slice(cssAt)

const replaceOnce = (anchor, next, label) => {
  if (!out.includes(anchor)) throw new Error(`port: anchor not found: ${label}`)
  out = out.replace(anchor, next)
}

// 1. The returned plugin object becomes a named module export.
replaceOnce(
  "return {\n  inject: ['slots', 'sessions'],",
  "const plugin = {\n  name: 'chat-timeline-diff',\n  inject: ['slots', 'sessions', 'remote.workspaceFiles'],",
  'plugin object',
)

// 2. Capture the Remote namespace service next to the slots lookup.
replaceOnce(
  "    const slots = ctx.get('slots')\n    if (slots === undefined) return\n",
  "    const slots = ctx.get('slots')\n    if (slots === undefined) return\n\n    const remoteFiles = ctx.get('remote.workspaceFiles')\n",
  'slots lookup',
)

// 3. Read file content through the session-scoped Remote instead of a host RPC.
replaceOnce(
  [
    '      React.useEffect(() => {',
    '        if (reads.key === revKey) return',
    "        const hostApi = typeof host !== 'undefined' && host !== null && host !== undefined ? host : null",
    '        const contents = new Map()',
    "        if (hostApi === null || files.length === 0 || cwd === undefined || cwd === '') {",
    '          setReads({ key: revKey, contents, hostOk: false })',
    '          return',
    '        }',
    '        let alive = true',
    "        hostApi.call('fd.readFile', { cwd, paths: files.map((f) => f.path) }).then((res) => {",
    '          if (!alive) return',
    "          if (res !== null && typeof res === 'object' && res.contents !== null && typeof res.contents === 'object') {",
    '            for (const [path, value] of Object.entries(res.contents)) {',
    "              if (typeof value === 'string') contents.set(path, canonText(value))",
    '            }',
    '          }',
    '          setReads({ key: revKey, contents, hostOk: true })',
    '        }).catch(() => {',
    '          if (alive) setReads({ key: revKey, contents, hostOk: false })',
    '        })',
    '        return () => { alive = false }',
    '      }, [revKey])',
  ].join('\n'),
  [
    '      React.useEffect(() => {',
    '        if (reads.key === revKey) return',
    '        const contents = new Map()',
    "        if (remoteFiles === undefined || files.length === 0 || cwd === undefined || cwd === '') {",
    '          setReads({ key: revKey, contents, hostOk: false })',
    '          return',
    '        }',
    '        let alive = true',
    '        const paths = files.map((f) => f.path)',
    '        Promise.all(paths.map((path) => readWorkspaceFile(remoteFiles, sessionId, path))).then((values) => {',
    '          if (!alive) return',
    '          for (let i = 0; i < paths.length; i += 1) {',
    '            const value = values[i]',
    "            if (typeof value === 'string') contents.set(paths[i], canonText(value))",
    '          }',
    '          setReads({ key: revKey, contents, hostOk: true })',
    '        }).catch(() => {',
    '          if (alive) setReads({ key: revKey, contents, hostOk: false })',
    '        })',
    '        return () => { alive = false }',
    '      }, [revKey])',
  ].join('\n'),
  'host read effect',
)

// 4. Inject the stylesheet as a real <style> element owned by the plugin fiber.
replaceOnce(
  '    ctx.effect(() => styles.insert(CSS))',
  [
    '    ctx.effect(() => {',
    "      const style = document.createElement('style')",
    "      style.setAttribute('data-dsh-plugin', 'chat-timeline-diff')",
    '      style.textContent = CSS',
    '      document.head.appendChild(style)',
    '      return () => { style.remove() }',
    '    })',
  ].join('\n'),
  'styles.insert',
)

// 5. Close the plugin object and export it.
const tail = '\n  },\n}\n'
if (!out.endsWith(tail)) throw new Error('port: unexpected file tail')
out = out.slice(0, -tail.length) + '\n  },\n}\n\nmodule.exports = plugin\n'

writeFileSync(to, out)
process.stdout.write(`port: wrote ${to} (${out.length} bytes)\n`)
