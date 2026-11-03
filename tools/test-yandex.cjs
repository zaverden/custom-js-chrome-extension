const assert = require('node:assert/strict'),
  fs = require('fs'),
  path = require('path'),
  http = require('http')
const { launch, load, delay } = require('./browser-harness.cjs')
const work = path.resolve('work/yandex-test-' + Date.now())
fs.mkdirSync(work, { recursive: true })
const profile = path.join(work, 'profile')
const passed = []
const ok = (name) => {
  passed.push(name)
  console.log('PASS', name)
}
let offline = false,
  downloads = 0
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/lib')) {
    downloads++
    if (offline) {
      res.statusCode = 503
      return res.end('unavailable')
    }
    res.setHeader('Content-Type', 'application/javascript')
    return res.end(
      req.url.startsWith('/lib-a')
        ? 'window.order=["a"];window.sharedValue=40;'
        : 'window.order.push("b");window.sharedValue+=2;',
    )
  }
  res.setHeader('Content-Security-Policy', "script-src 'none'")
  res.end(
    '<!doctype html><title>CustomJS fixture</title><body><div class="later">fixture</div>' +
      (req.url === '/frame' ? '' : '<iframe src="/frame"></iframe>') +
      '</body>',
  )
})
const rule = (source, config = {}) => ({
  source,
  config: { enable: true, ...config },
})
;(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const origin = 'http://127.0.0.1:' + server.address().port
  let session
  try {
    session = await launch(profile)
    const id = await load(session, path.resolve('build'), false)
    let popup = await session.context.newPage()
    await popup.goto(
      'chrome-extension://' +
        id +
        '/popup.html#/?domain=' +
        encodeURIComponent(origin),
    )
    const send = (message) =>
      popup.evaluate((message) => chrome.runtime.sendMessage(message), message)
    assert.match((await send({ method: 'apply' })).error, /Allow user scripts/)
    ok('missing userScripts access produces an actionable error')
    await session.manager.evaluate(
      (id) =>
        chrome.developerPrivate.updateExtensionConfiguration({
          extensionId: id,
          userScriptsAccess: true,
        }),
      id,
    )
    await popup.reload()
    assert.equal((await send({ method: 'apply' })).error, '')
    await popup.waitForSelector('#code-editor .monaco-editor')
    ok('Monaco editor renders under MV3 CSP')
    const regex = { isRegex: true, pattern: '/regex' }
    const isolated = { isRegex: true, pattern: '/isolated' }
    const data = { hosts: [origin, regex, isolated] }
    data[origin] = rule(
      'window.userRuns=(window.userRuns||0)+1;document.body.dataset.value=sharedValue;document.body.dataset.order=order.join(",");customjsReady(".later",e=>e.dataset.ready="yes");',
      { extra: origin + '/lib-a.js;\n' + origin + '/lib-b.js' },
    )
    data[regex.pattern] = rule('document.body.dataset.regex="yes";')
    data[isolated.pattern] = rule(
      'document.body.dataset.isolated=typeof window.sharedValue;window.isolatedOnly=true;',
      { world: 'USER_SCRIPT' },
    )
    let result = await send({
      method: 'import',
      backup: { data },
      replace: true,
    })
    assert.equal(result.imported, 3, JSON.stringify(result))
    const target = await session.context.newPage()
    await target.goto(origin + '/regex')
    await target.waitForFunction(
      () =>
        document.body.dataset.value === '42' &&
        document.body.dataset.regex === 'yes',
    )
    assert.equal(
      await target.evaluate(() => document.body.dataset.order),
      'a,b',
    )
    assert.equal(
      await target.locator('.later').getAttribute('data-ready'),
      'yes',
    )
    assert.equal(await target.evaluate(() => window.userRuns), 1)
    assert.equal(
      await target.frames()[1].evaluate(() => document.body.dataset.value),
      '42',
    )
    ok(
      'MAIN globals, frames, ordered external libraries, regex, customjsReady and strict page CSP',
    )
    await target.goto(origin + '/isolated')
    await target.waitForFunction(
      () => document.body.dataset.isolated === 'undefined',
    )
    assert.equal(
      await target.evaluate(() => typeof window.isolatedOnly),
      'undefined',
    )
    ok('USER_SCRIPT context shares DOM and isolates page globals')
    const exported = await send({ method: 'export' })
    assert.equal(exported.data.hosts.length, 3)
    assert.equal(exported.data[isolated.pattern].config.world, 'USER_SCRIPT')
    ok('JSON export retains legacy-compatible sources and execution context')
    const invalid = { hosts: [origin], [origin]: rule('var = ;') }
    assert.ok(
      (await send({ method: 'import', backup: invalid, replace: true })).error,
    )
    assert.equal(
      (await send({ method: 'export' })).data[origin].source,
      data[origin].source,
    )
    ok('syntax errors keep previous saved code')
    const badLibrary = {
      hosts: [origin],
      [origin]: rule('document.body.dataset.bad="yes";', {
        extra: origin + '/lib-missing.js',
      }),
    }
    offline = true
    assert.ok(
      (await send({ method: 'import', backup: badLibrary, replace: true }))
        .error,
    )
    assert.equal(
      (await send({ method: 'export' })).data[origin].source,
      data[origin].source,
    )
    ok('failed library download preserves saved scripts')
    const count = downloads
    await target.reload()
    await target.waitForFunction(() => document.body.dataset.value === '42')
    assert.equal(downloads, count)
    ok('navigation uses cached libraries without network requests')
    await popup.screenshot({
      path: path.join(work, 'editor.png'),
      fullPage: true,
    })
    await session.close()
    session = null
    session = await launch(profile)
    await load(session, path.resolve('build'))
    popup = await session.context.newPage()
    await popup.goto(
      'chrome-extension://' +
        id +
        '/popup.html#/?domain=' +
        encodeURIComponent(origin),
    )
    await popup.waitForSelector('#code-editor .monaco-editor')
    assert.equal((await send({ method: 'apply' })).error, '')
    const restored = await session.context.newPage()
    await restored.goto(origin + '/regex')
    await restored.waitForFunction(
      () =>
        document.body.dataset.value === '42' &&
        document.body.dataset.regex === 'yes',
    )
    assert.equal(downloads, count)
    ok(
      'browser process restart + extension reload restores data and cached libraries offline',
    )
    const workerSession = await session.context.newCDPSession(session.manager)
    await workerSession.send('ServiceWorker.enable')
    await workerSession.send('ServiceWorker.stopAllWorkers')
    await delay(500)
    assert.equal((await send({ method: 'apply' })).error, '')
    await restored.reload()
    await restored.waitForFunction(() => document.body.dataset.value === '42')
    ok(
      'extension service worker restart restores execution state without window APIs',
    )
    const pageErrors = []
    popup.on('pageerror', (e) => pageErrors.push(e.message))
    await popup.reload()
    await popup.waitForSelector('#code-editor .monaco-editor')
    await popup.evaluate(() =>
      window.monaco.editor
        .getModels()[0]
        .setValue('document.body.dataset.ui="saved";'),
    )
    await delay(650)
    await popup.getByRole('button', { name: 'Save', exact: true }).click()
    await delay(500)
    const saved = await send({ method: 'export' })
    assert.match(saved.data[origin].source, /^data:text\/javascript/)
    await restored.reload()
    await restored.waitForFunction(() => document.body.dataset.ui === 'saved')
    assert.deepEqual(pageErrors, [])
    ok('editing and Save in original UI execute the saved script')
    await popup.evaluate(() =>
      window.monaco.editor.getModels()[0].setValue('// unsaved draft'),
    )
    await delay(650)
    await popup.reload()
    await popup.waitForSelector('#code-editor .monaco-editor')
    assert.equal(
      await popup.evaluate(() =>
        window.monaco.editor.getModels()[0].getValue(),
      ),
      '// unsaved draft',
    )
    ok('draft survives editor reload without changing saved code')
    const disabled = await send({ method: 'export' })
    disabled.data[origin].config.enable = false
    assert.equal(
      (await send({ method: 'import', backup: disabled, replace: true }))
        .imported,
      3,
    )
    await restored.reload()
    await delay(500)
    assert.equal(
      await restored.evaluate(() => document.body.dataset.ui),
      undefined,
    )
    ok('disabled script stops running after page reload')
    await popup.goto('chrome-extension://' + id + '/popup.html#/list')
    await popup
      .getByText('All Hosts & Patterns', { exact: true })
      .last()
      .waitFor()
    assert.equal(await popup.locator('tbody tr').count(), 3)
    const removed = await send({
      method: 'removeData',
      isRegex: true,
      pattern: regex.pattern,
    })
    assert.equal(removed, null)
    assert.equal((await send({ method: 'export' })).data.hosts.length, 2)
    await restored.goto(origin + '/regex')
    await delay(300)
    assert.equal(
      await restored.evaluate(() => document.body.dataset.regex),
      undefined,
    )
    ok(
      'host table works in an extension tab and regex deletion stops execution',
    )
    const restricted = await send({
      method: 'getData',
      domain: 'chrome://extensions',
    })
    assert.match(restricted.error, /regular HTTP/)
    ok(
      'browser internal pages return a clear message without creating invalid hosts',
    )
    const info = await session.manager.evaluate(
      async (id) =>
        (
          await chrome.developerPrivate.getExtensionsInfo({
            includeDisabled: true,
          })
        ).find((e) => e.id === id),
      id,
    )
    assert.deepEqual(info.manifestErrors, [])
    assert.deepEqual(info.runtimeErrors, [])
    fs.writeFileSync(
      path.join(work, 'results.json'),
      JSON.stringify(
        {
          ua: await popup.evaluate(() => navigator.userAgent),
          passed,
          testedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    )
    console.log('RESULTS', work)
  } finally {
    if (session) await session.close()
    server.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
