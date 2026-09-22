// Chat Timeline File Diff Viewer — host entry.
//
// Every behavior lives in the `dsh.client` half (built to lib/client.js). This
// entry exists so the package is a host Loader entry: the client module system
// discovers a package's `dsh.client` declaration from the loader entry named in
// cordis.patch.yml, and serves lib/client.js to the browser on that basis.
//
// It is deliberately a no-op and injects nothing, so it mounts immediately and
// can never keep the profile from booting.

export const name = 'timeline-diff'

export function apply() {}
