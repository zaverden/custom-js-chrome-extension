const assert = require('node:assert/strict'),
  fs = require('fs'),
  path = require('path'),
  http = require('http')
const { launch, load } = require('./browser-harness.cjs')
const server = http.createServer((req, res) => {
  res.setHeader('Content-Security-Policy', "script-src 'none'")
  res.end('<!doctype html><title>jQuery fixture</title><body>test</body>')
})
;(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  let s
  try {
    const origin = 'http://127.0.0.1:' + server.address().port
    s = await launch(path.resolve('work/jquery-profile-' + Date.now()))
    const id = await load(s, path.resolve('build'))
    const popup = await s.context.newPage()
    await popup.goto(
      'chrome-extension://' +
        id +
        '/popup.html#/?domain=' +
        encodeURIComponent(origin),
    )
    await popup.waitForSelector('#code-editor .monaco-editor')
    const versions = ['1.12.4', '2.2.4', '3.2.1'],
      data = { hosts: [] }
    for (const [i, v] of versions.entries()) {
      const h = { isRegex: true, pattern: '/jquery' + i + '$' }
      data.hosts.push(h)
      data[h.pattern] = {
        config: { enable: true, include: '/jquery/' + v + '/jquery.min.js' },
        source:
          'document.body.dataset.version=jQuery.fn.jquery;document.body.dataset.selected=jQuery("body").length;',
      }
    }
    const h = { isRegex: true, pattern: '/isolated$' }
    data.hosts.push(h)
    data[h.pattern] = {
      config: {
        enable: true,
        include: '/jquery/3.2.1/jquery.min.js',
        world: 'USER_SCRIPT',
      },
      source: 'document.body.dataset.version=jQuery.fn.jquery;',
    }
    const r = await popup.evaluate(
      (backup) =>
        chrome.runtime.sendMessage({ method: 'import', backup, replace: true }),
      data,
    )
    assert.equal(r.imported, 4, JSON.stringify(r))
    const target = await s.context.newPage()
    for (const [i, v] of versions.entries()) {
      await target.goto(origin + '/jquery' + i)
      await target.waitForFunction(() => document.body.dataset.version)
      assert.equal(
        await target.evaluate(() => document.body.dataset.version),
        v,
      )
      assert.equal(
        await target.evaluate(() => document.body.dataset.selected),
        '1',
      )
      console.log('PASS jQuery ' + v + ' MAIN DOM under strict page CSP')
    }
    await target.goto(origin + '/isolated')
    await target.waitForFunction(() => document.body.dataset.version)
    assert.equal(
      await target.evaluate(() => document.body.dataset.version),
      '3.2.1',
    )
    assert.equal(await target.evaluate(() => typeof window.jQuery), 'undefined')
    console.log('PASS jQuery 3.2.1 USER_SCRIPT isolation')
    const cache = await popup.evaluate(async () => {
      const x = (await chrome.storage.local.get('_mv3Libraries'))._mv3Libraries
      return Object.values(x).map((v) => ({
        sha256: v.sha256,
        fetchedAt: v.fetchedAt,
      }))
    })
    assert.equal(cache.length, 3)
    console.log('CACHE', JSON.stringify(cache))
  } finally {
    if (s) await s.close()
    server.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
