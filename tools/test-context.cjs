const assert = require('node:assert/strict'),
  path = require('path'),
  http = require('http')
const { launch, load } = require('./browser-harness.cjs')
const handler = (req, res) => {
  res.setHeader('Content-Security-Policy', "script-src 'none'")
  res.end('<!doctype html><title>Scope fixture</title><body>scope</body>')
}
const first = http.createServer(handler),
  second = http.createServer(handler)
;(async () => {
  await new Promise((r) => first.listen(0, '127.0.0.1', r))
  await new Promise((r) => second.listen(0, '127.0.0.1', r))
  let s
  try {
    const origin = 'http://127.0.0.1:' + first.address().port,
      other = 'http://127.0.0.1:' + second.address().port
    s = await launch(path.resolve('work/scope-profile-' + Date.now()))
    const id = await load(s, path.resolve('build'))
    const popup = await s.context.newPage()
    await popup.goto(
      'chrome-extension://' +
        id +
        '/popup.html#/?domain=' +
        encodeURIComponent(origin)
    )
    const pattern = { isRegex: true, pattern: '/scope$' }
    const data = {
      hosts: [origin, pattern],
      [origin]: { config: { enable: true }, source: 'window.originOnly=1;' },
      [pattern.pattern]: {
        config: { enable: true },
        source:
          '"use strict"; let customjsLexical=17; var customjsVar=19; function customjsFunction(){return 23}; window.customjsStrict=(function(){return this})()===undefined;document.body.dataset.scope="yes";',
      },
    }
    assert.equal(
      (
        await popup.evaluate(
          (backup) =>
            chrome.runtime.sendMessage({
              method: 'import',
              backup,
              replace: true,
            }),
          data
        )
      ).imported,
      2
    )
    const target = await s.context.newPage()
    await target.goto(origin + '/scope')
    await target.waitForFunction(() => document.body.dataset.scope === 'yes')
    const actual = await target.evaluate(() => ({
      lexical: customjsLexical,
      global: window.customjsVar,
      fn: window.customjsFunction(),
      strict: window.customjsStrict,
    }))
    assert.deepEqual(actual, { lexical: 17, global: 19, fn: 23, strict: true })
    console.log(
      'PASS native MAIN top-level let, var, function and strict directive',
      JSON.stringify(actual)
    )
    await target.goto(other + '/other')
    await target.waitForTimeout(500)
    assert.deepEqual(
      await target.evaluate(() => ({
        origin: typeof window.originOnly,
        lexical: typeof customjsLexical,
        global: typeof customjsVar,
      })),
      { origin: 'undefined', lexical: 'undefined', global: 'undefined' }
    )
    console.log(
      'PASS unmatched origin/port receives no user code or hoisted declarations'
    )
  } finally {
    if (s) await s.close()
    first.close()
    second.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
