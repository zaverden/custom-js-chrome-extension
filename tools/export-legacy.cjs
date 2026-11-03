// Reads only a backup copy in an isolated browser profile. Never executes old scripts.
const fs = require('fs'),
  path = require('path')
const { launch } = require('./browser-harness.cjs')
const { validate, hostKey, decode, libraries } = require('../src/js/mv3/core')
;(async () => {
  const backup = path.resolve(process.argv[2] || '')
  if (
    !process.argv[2] ||
    !fs.existsSync(path.join(backup, 'original-manifest.json'))
  )
    throw Error(
      'Pass a verified Windows backup directory from backup-legacy.ps1'
    )
  const id = 'ddbjnfjiigjmcpcpkmhogomapikjbjdk'
  const work = path.resolve('work/legacy-export-' + Date.now())
  const profile = path.join(work, 'profile'),
    bridge = path.join(work, 'bridge')
  fs.mkdirSync(bridge, { recursive: true })
  for (const kind of ['Local Extension Settings', 'Sync Extension Settings']) {
    fs.cpSync(
      path.join(backup, kind),
      path.join(profile, 'Default', kind, id),
      { recursive: true }
    )
  }
  const old = JSON.parse(
    fs
      .readFileSync(path.join(backup, 'original-manifest.json'), 'utf8')
      .replace(/^\uFEFF/, '')
  )
  if (!old.key)
    throw Error(
      'The original public manifest key is needed to address its copied storage'
    )
  fs.writeFileSync(
    path.join(bridge, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Read-only CustomJS legacy export bridge',
      version: '1.0.0',
      key: old.key,
      permissions: ['storage'],
    })
  )
  fs.writeFileSync(
    path.join(bridge, 'export.html'),
    '<!doctype html><title>Legacy backup reader</title>'
  )
  const session = await launch(profile)
  try {
    const loaded = await session.cdp.send('Extensions.loadUnpacked', {
      path: bridge,
    })
    if (loaded.id !== id) throw Error('Legacy extension ID mismatch')
    const page = await session.context.newPage()
    await page.goto('chrome-extension://' + id + '/export.html')
    const stores = await page.evaluate(async () => ({
      sync: await chrome.storage.sync.get(null),
      local: await chrome.storage.local.get(null),
    }))
    fs.writeFileSync(
      path.join(backup, 'legacy-storage-export.json'),
      JSON.stringify({ format: 'customjs-legacy-storage', ...stores }, null, 2)
    )
    const raw =
      Array.isArray(stores.local.hosts) && stores.local.hosts.length
        ? stores.local
        : stores.sync
    const skipped = []
    const hosts = (raw.hosts || []).filter((host) => {
      try {
        hostKey(host)
        return true
      } catch {
        skipped.push({
          host,
          rule: raw[typeof host === 'string' ? host : host?.pattern],
        })
        return false
      }
    })
    const data = validate({ ...raw, hosts })
    fs.writeFileSync(
      path.join(backup, 'legacy-skipped.json'),
      JSON.stringify(skipped, null, 2)
    )
    const { parse } = require('acorn')
    const issues = []
    for (const host of data.hosts) {
      const key = hostKey(host),
        rule = data[key]
      if (!rule) continue
      try {
        parse(decode(rule.source), { ecmaVersion: 'latest' })
        libraries(rule.config)
      } catch (e) {
        issues.push({ host, error: e.message })
      }
    }
    fs.writeFileSync(
      path.join(backup, 'import-readiness.json'),
      JSON.stringify(
        {
          hosts: data.hosts.length,
          savedScripts: data.hosts.filter((h) => data[hostKey(h)]).length,
          skipped: skipped.length,
          issues,
        },
        null,
        2
      )
    )
    fs.writeFileSync(
      path.join(backup, 'legacy-import.json'),
      JSON.stringify({ format: 'customjs-mv3', version: 1, data }, null, 2)
    )
    console.log(
      JSON.stringify({
        hosts: data.hosts.length,
        savedScripts: data.hosts.filter((h) => data[hostKey(h)]).length,
        skipped: skipped.length,
        syntaxOrLibraryIssues: issues.length,
      })
    )
  } finally {
    await session.close()
  }
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
