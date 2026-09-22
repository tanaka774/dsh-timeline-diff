// DSH Session Files & Diffs — dynamic Cordis plugin HOST payload.
//
// This file is the exact `code.host` value for `cordis_define`:
// a plain-JavaScript function body that returns the host-half Cordis Plugin.
// Do not add imports or TypeScript — the dynamic evaluator provides `ctx`,
// `harness` and `console`.
//
// It exposes exactly one Package-private RPC for the client half:
//   fd.readFile({ cwd, paths }) -> { contents: { [path]: string | null } }
// a read-only snapshot of each requested file's current on-disk content.
// Every read is contained under the session workspace (`cwd`) when one is
// given; per-file failures (absent file, unreadable, outside the root,
// binary, denied by the sandbox) yield null so the UI can fall back to the
// plain per-change rendering.

return {
  inject: ['fs'],
  apply(ctx) {
    const fs = ctx.get('fs')
    if (fs === undefined) return

    const readOne = async (cwd, path) => {
      if (typeof path !== 'string' || path === '') return null
      try {
        const target = await fs.resolve(path, cwd ? { cwd } : undefined)
        if (cwd) {
          const root = await fs.resolve(cwd)
          if (root === undefined || target === undefined || !fs.contains(root, target)) return null
        }
        const text = await fs.readText(target)
        return typeof text === 'string' ? text : null
      } catch (error) {
        return null
      }
    }

    ctx.effect(() => harness.handle('fd.readFile', async (args) => {
      const input = args !== null && typeof args === 'object' ? args : {}
      const cwd = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : null
      const paths = Array.isArray(input.paths)
        ? input.paths.filter((p) => typeof p === 'string').slice(0, 200)
        : []
      const contents = {}
      for (const path of paths) {
        contents[path] = cwd === null ? null : await readOne(cwd, path)
      }
      return { contents }
    }))
  },
}
