// Offline check for the client view layer.
//
// Three things are verified without a browser:
//   1. the `__fd-code-begin/end` block (language selection, run grouping, and the
//      row renderer) against a stub React + a stub CodeBlock;
//   2. the `__fd-answer-begin/end` block (the `labels` the harness Markdown
//      renderer requires, and the boundary that degrades a render failure to plain
//      text) against a stub React + a stub MarkdownText;
//   3. the whole bundle factory still registers, its `apply` reaches
//      `slots.register` with the view, and the legacy dynamic payload still
//      compiles and applies — using stub cordis ctx / slot services.
//
// Usage: node scripts/check-client.mjs

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'src', 'client.js'), 'utf8')

let failures = 0
const check = (label, condition, detail) => {
  if (condition) return
  failures += 1
  process.stdout.write(`FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}\n`)
}

const assertEqual = (label, actual, expected) => {
  check(label, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// ---------------------------------------------------------------- slice ---- //

const begin = source.indexOf('// __fd-code-begin')
const end = source.indexOf('// __fd-code-end')
check('markers present', begin !== -1 && end !== -1 && begin < end)
const region = source.slice(source.indexOf('\n', begin) + 1, end)

// A minimal element-shaped React: createElement returns plain objects, which is
// all the assertions below need.
const makeReact = () => ({
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  memo: (component) => component,
  Component: class Component { constructor(props) { this.props = props } },
  Fragment: Symbol('Fragment'),
})

const codeBlockStub = function StubCodeBlock() { return null }

const loadRegion = (CodeBlock) => {
  const factory = new Function('React', 'CodeBlock', `${region}\nreturn { languageForPath, rowGroups, RowLines }`)
  return factory(makeReact(), CodeBlock)
}

const { languageForPath, rowGroups, RowLines } = loadRegion(codeBlockStub)

// -------------------------------------------------------- language map ---- //

assertEqual('js', languageForPath('src/client.js'), 'javascript')
assertEqual('tsx', languageForPath('/a/b/View.tsx'), 'typescript')
assertEqual('md', languageForPath('README.md'), 'markdown')
assertEqual('yml', languageForPath('ci.yml'), 'yaml')
assertEqual('c header', languageForPath('foo.h'), 'c')
assertEqual('windows path', languageForPath('a\\b\\script.py'), 'python')
assertEqual('upper case', languageForPath('MAIN.CPP'), 'cpp')
assertEqual('extensionless', languageForPath('Makefile'), undefined)
assertEqual('unknown extension', languageForPath('archive.tar.gz'), undefined)
assertEqual('dotfile', languageForPath('.gitignore'), undefined)
assertEqual('empty', languageForPath(''), undefined)
assertEqual('non-string', languageForPath(null), undefined)

// -------------------------------------------------------------- grouping ---- //

const grouped = rowGroups([
  { kind: 'ctx', text: 'a' },
  { kind: 'del', text: 'b' },
  { kind: 'del', text: 'c' },
  { kind: 'add', text: 'd' },
  { kind: 'add', text: 'e' },
  { kind: 'add', text: 'f' },
  { kind: 'ctx', text: 'g' },
])
assertEqual('group count', grouped.length, 4)
assertEqual('group kinds', grouped.map((g) => g.kind).join(','), 'ctx,del,add,ctx')
assertEqual('group lines', grouped.map((g) => g.lines.join('|')).join(';'), 'a;b|c;d|e|f;g')
assertEqual('empty rows', rowGroups([]).length, 0)

// -------------------------------------------------------------- rendering ---- //

const rows = [
  { kind: 'ctx', text: 'const a = 1' },
  { kind: 'del', text: 'const b = 2' },
  { kind: 'add', text: 'const b = 3' },
  { kind: 'add', text: 'const c = 4' },
]

const tree = RowLines({ rows, path: 'src/x.js' })
assertEqual('hunk wrapper', tree.props.className, 'fd-hunk')
const groups = tree.props.children
assertEqual('renders one block per run', groups.length, 3)
assertEqual('run classes', groups.map((g) => g.props.className).join(' '), 'fd-code fd-code-ctx fd-code fd-code-del fd-code fd-code-add')
const blocks = groups.map((g) => g.props.children[0])
assertEqual('block type', blocks[0].type, codeBlockStub)
assertEqual('ctx code', blocks[0].props.code, 'const a = 1')
assertEqual('del code', blocks[1].props.code, 'const b = 2')
assertEqual('add code joins its run', blocks[2].props.code, 'const b = 3\nconst c = 4')
assertEqual('lang', blocks[0].props.lang, 'javascript')
assertEqual('streaming off', blocks[0].props.streaming, false)
assertEqual('numbered layout', blocks[0].props.lineNumbers, true)

// Unknown suffix: every row stays a plain row, no CodeBlock at all.
const plain = RowLines({ rows, path: 'Makefile' })
assertEqual('plain row count', plain.props.children.length, 4)
assertEqual('plain row class', plain.props.children[0].props.className, 'fd-line fd-line-ctx')
assertEqual('plain sign', plain.props.children[1].props.children[0].props.children[0], '-')
assertEqual('plain add sign', plain.props.children[2].props.children[0].props.children[0], '+')

// No primitive exported by the harness: same plain fallback.
const withoutPrimitive = loadRegion(null)
const degraded = withoutPrimitive.RowLines({ rows, path: 'src/x.js' })
assertEqual('degraded row count', degraded.props.children.length, 4)
assertEqual('degraded row class', degraded.props.children[2].props.className, 'fd-line fd-line-add')

// --------------------------------------------------------- answers ---- //

const answerBegin = source.indexOf('// __fd-answer-begin')
const answerEnd = source.indexOf('// __fd-answer-end')
check('answer markers present', answerBegin !== -1 && answerEnd !== -1 && answerBegin < answerEnd)
const answerRegion = source.slice(source.indexOf('\n', answerBegin) + 1, answerEnd)

const loadAnswer = (MarkdownText) => new Function('React', 'MarkdownText',
  `${answerRegion}\nreturn { MARKDOWN_LABELS, MarkdownBoundary, AnswerText }`)(makeReact(), MarkdownText)

const markdownStub = function StubMarkdownText() { return null }
const answer = loadAnswer(markdownStub)
const rendered = answer.AnswerText({ text: '# hi', className: 'fd-section-answer-text' })
assertEqual('answer wrapper class', rendered.props.className, 'fd-section-answer-text fd-answer-markdown')
const boundary = rendered.props.children[0]
assertEqual('answer is wrapped in the boundary', boundary.type, answer.MarkdownBoundary)
assertEqual('boundary keyed by text', boundary.props.key, '# hi')
assertEqual('boundary fallback is the plain text', boundary.props.fallback.props.children[0], '# hi')
const markdown = boundary.props.children[0]
assertEqual('markdown component', markdown.type, markdownStub)
assertEqual('markdown text', markdown.props.text, '# hi')
// The renderer reads these three without a guard; omitting them is what blanked the tab.
assertEqual('code copy label', markdown.props.labels.code.copyLabel, 'Copy')
assertEqual('code copied label', markdown.props.labels.code.copiedLabel, 'Copied')
assertEqual('footnotes label', markdown.props.labels.footnotes, 'Footnotes')

const boundaryInstance = new answer.MarkdownBoundary({ fallback: 'FALLBACK', children: 'CHILD' })
assertEqual('boundary renders children unharmed', boundaryInstance.render(), 'CHILD')
boundaryInstance.state.failed = true
assertEqual('boundary degrades to the fallback', boundaryInstance.render(), 'FALLBACK')
assertEqual('boundary maps a render error to failed',
  answer.MarkdownBoundary.getDerivedStateFromError().failed, true)

// No renderer exported by the harness: plain text, no boundary, no markdown wrapper.
const plainAnswer = loadAnswer(null).AnswerText({ text: 'hello', className: 'fd-x' })
assertEqual('no renderer -> plain class', plainAnswer.props.className, 'fd-x fd-answer-plain')
assertEqual('no renderer -> raw text', plainAnswer.props.children[0], 'hello')

// ---------------------------------------------------------- whole module ---- //

const registered = []
const ctx = {
  get: (name) => (name === 'slots' ? slots : { readAll: async () => null }),
  effect: () => {},
  sessions: { binding: () => undefined },
}
const slots = {
  inject: (_name, fn) => fn(),
  register: (definition, component) => {
    registered.push({ definition, component })
    return { id: definition.id }
  },
}

const module = { exports: {} }
const fakeRequire = (id) => {
  if (id === 'react') return makeReact()
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText: () => null, CodeBlock: codeBlockStub }
  throw new Error(`unexpected require(${id})`)
}
new Function('require', 'module', 'exports', source)(fakeRequire, module, module.exports)

const plugin = module.exports
assertEqual('plugin name', plugin.name, 'timeline-diff')
check('plugin apply', typeof plugin.apply === 'function')
plugin.apply(ctx)
assertEqual('one view registered', registered.length, 1)
assertEqual('registered tab id', registered[0].definition.id, 'diff')
check('registered component', typeof registered[0].component === 'function')

// The shipped artifact, through its real `window.__ModuleLoader__` envelope.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
let envelope = null
globalThis.window = { __ModuleLoader__: { load: (registration) => { envelope = registration } } }
new Function(readFileSync(join(root, 'lib', 'client.js'), 'utf8'))()
check('bundle registers', envelope !== null)
assertEqual('bundle id', envelope.id, pkg.name)
const bundled = envelope.factory(fakeRequire)
assertEqual('bundle exports the plugin', bundled.name, 'timeline-diff')

// The legacy dynamic payload keeps mirroring src: it must still compile as an
// evaluator body and apply, and (with no `require` in scope) degrade to plain rows.
const dynamicSource = readFileSync(join(root, 'dynamic', 'plugin-client.js'), 'utf8')
const dynamicPlugin = new Function('React', 'styles', 'host', dynamicSource)(makeReact(), { insert: () => {} }, undefined)
const dynamicRegistered = []
dynamicPlugin.apply({
  get: (name) => (name === 'slots'
    ? {
      inject: (_slot, fn) => fn(),
      register: (definition) => { dynamicRegistered.push(definition); return { id: definition.id } },
    }
    : undefined),
  effect: () => {},
  sessions: { binding: () => undefined },
})
assertEqual('dynamic payload registers one view', dynamicRegistered.length, 1)
check('dynamic payload mirrors the guarded lookup', dynamicSource.includes("const CodeBlock = primitive('CodeBlock')"))
check('no require in the dynamic evaluator scope', new Function('return typeof require')() === 'undefined')

process.stdout.write(failures === 0
  ? `check-client: OK (${String(registered.length)} view registered, answer labels + boundary present, bundle factory returns the plugin, all assertions passed)\n`
  : `check-client: ${String(failures)} failure(s)\n`)
process.exitCode = failures === 0 ? 0 : 1
