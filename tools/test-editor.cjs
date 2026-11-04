const assert = require('node:assert/strict'),
  fs = require('fs'),
  path = require('path')
const { launch, load, delay } = require('./browser-harness.cjs')
const work = path.resolve('work/editor-test-' + Date.now())
fs.mkdirSync(work, { recursive: true })
const passed = []
const ok = (name) => {
  passed.push(name)
  console.log('PASS', name)
}
;(async () => {
  const session = await launch(path.join(work, 'profile'))
  const requests = [],
    errors = []
  try {
    await session.context.setOffline(true)
    session.context.on('request', (request) => {
      if (/^https?:/.test(request.url())) requests.push(request.url())
    })
    const id = await load(session, path.resolve('build')),
      base = 'chrome-extension://' + id + '/popup.html'
    const popup = await session.context.newPage()
    popup.on('pageerror', (error) => {
      errors.push(error.message)
      console.error('PAGE ERROR', error.message)
    })
    await popup.goto(
      base + '#/?domain=' + encodeURIComponent('https://editor.example'),
    )
    await popup.waitForSelector('#code-editor .monaco-editor')
    const set = (source) =>
      popup.evaluate((source) => {
        const m = window.monaco.editor.getModels()[0],
          e = window.monaco.editor.getEditors()[0]
        m.setValue(source)
        e.setPosition(m.getPositionAt(source.length))
        e.focus()
      }, source)
    const get = () =>
      popup.evaluate(() => window.monaco.editor.getModels()[0].getValue())
    const send = (message) =>
      popup.evaluate((message) => chrome.runtime.sendMessage(message), message)
    await set('document.que')
    await popup.keyboard.press('Control+Space')
    await popup.locator('.suggest-widget.visible').waitFor()
    await popup
      .locator('.suggest-widget.visible .monaco-list-row')
      .filter({ hasText: 'querySelector' })
      .first()
      .waitFor({ timeout: 30000 })
    ok(
      'DOM completion comes from the local JavaScript language worker while offline',
    )
    await popup.keyboard.press('Escape')
    await set('const user = { displayName: "Denis", active: true };\nuser.')
    await popup.keyboard.press('Control+Space')
    await popup
      .locator('.suggest-widget.visible .monaco-list-row')
      .filter({ hasText: 'displayName' })
      .first()
      .waitFor()
    ok('completion infers properties of user-defined objects')
    await popup.keyboard.press('Escape')
    await set('customjs')
    await popup.keyboard.press('Control+Space')
    await popup
      .locator('.suggest-widget.visible .monaco-list-row')
      .filter({ hasText: 'customjsReady' })
      .first()
      .waitFor()
    ok('customjsReady has a local completion and type declaration')
    await popup.keyboard.press('Escape')
    await set('document.addEventListener(')
    await popup.keyboard.press('Control+Shift+Space')
    await popup.locator('.parameter-hints-widget.visible').waitFor()
    ok('function parameter hints are available')
    await popup.keyboard.press('Escape')
    await set('const broken = ;')
    await popup.waitForFunction(() =>
      window.monaco.editor
        .getModelMarkers({})
        .some(
          (marker) => marker.severity === window.monaco.MarkerSeverity.Error,
        ),
    )
    ok('syntax errors are diagnosed in the editor')
    const raw = "const item={name:'hello',items:[1,2]}"
    await set(raw)
    await popup.getByRole('button', { name: 'Format', exact: true }).click()
    await popup.waitForFunction(() =>
      window.monaco.editor
        .getModels()[0]
        .getValue()
        .includes('const item = { name: "hello", items: [1, 2] };'),
    )
    const formatted = await get()
    assert.equal(
      formatted.replace(/\r\n/g, '\n'),
      'const item = { name: "hello", items: [1, 2] };\n',
    )
    await popup.locator('#code-editor .monaco-editor').click()
    await popup.keyboard.press('Control+z')
    assert.equal(await get(), raw)
    await popup.keyboard.press('Control+y')
    assert.equal(await get(), formatted)
    ok('Prettier formatting can be undone and redone')
    await set('function sum(a,b){return a+b}')
    await popup.keyboard.press('Shift+Alt+f')
    await popup.waitForFunction(() =>
      window.monaco.editor
        .getModels()[0]
        .getValue()
        .includes('function sum(a, b) {'),
    )
    ok('Shift+Alt+F formats through the bundled formatter worker')
    await set('const invalid = ;')
    await popup.getByRole('button', { name: 'Format', exact: true }).click()
    await popup.locator('.editor-format-error[role=alert]').first().waitFor()
    assert.equal(await get(), 'const invalid = ;')
    ok('formatting invalid code preserves the draft and displays the error')
    await set('const old={value:1};')
    await popup.getByRole('button', { name: 'Format', exact: true }).waitFor()
    await popup.evaluate(
      (button) => {
        button.click()
        window.monaco.editor.getModels()[0].setValue('const newValue = 2')
      },
      await popup
        .getByRole('button', { name: 'Format', exact: true })
        .elementHandle(),
    )
    await popup
      .getByRole('alert')
      .filter({ hasText: 'changed while formatting' })
      .waitFor()
    assert.equal(await get(), 'const newValue = 2')
    ok('a delayed formatting result cannot overwrite newer edits')
    await set('const value={ready:true};')
    await popup.getByRole('button', { name: 'Format', exact: true }).click()
    await popup.waitForFunction(() =>
      window.monaco.editor
        .getModels()[0]
        .getValue()
        .includes('const value = { ready: true }'),
    )
    await popup.getByRole('button', { name: 'Language mode' }).click()
    await popup.getByRole('option', { name: 'css', exact: true }).click()
    await set('body{color:red;margin:0}')
    await popup.keyboard.press('Shift+Alt+f')
    await popup.waitForFunction(() =>
      window.monaco.editor.getModels()[0].getValue().includes('color: red;'),
    )
    ok('CSS mode also uses the local formatter')
    await popup.getByRole('button', { name: 'Language mode' }).click()
    await popup.getByRole('option', { name: 'javascript', exact: true }).click()
    await popup.getByLabel('Editor theme').selectOption('vs-dark')
    await popup.getByLabel('Editor font size').selectOption('18')
    await popup.getByRole('button', { name: 'Word wrap', exact: true }).click()
    await set('window.editorSaved = true')
    await delay(650)
    await popup.reload()
    await popup.waitForSelector('#code-editor .monaco-editor')
    assert.equal(await popup.getByLabel('Editor theme').inputValue(), 'vs-dark')
    assert.equal(await popup.getByLabel('Editor font size').inputValue(), '18')
    assert.equal(
      await popup
        .getByRole('button', { name: 'Word wrap', exact: true })
        .getAttribute('aria-pressed'),
      'false',
    )
    assert.equal(await get(), 'window.editorSaved = true')
    ok('theme, font size, word wrap and the draft survive editor reload')
    await popup.locator('#code-editor .monaco-editor').click()
    await popup.keyboard.press('Control+s')
    await popup.waitForFunction(async () => {
      const e = await chrome.runtime.sendMessage({ method: 'export' })
      return !!e.data['https://editor.example']?.source
    })
    const exported = await send({ method: 'export' })
    assert.ok(exported.data['https://editor.example'].config.enable)
    ok('Ctrl+S saves the script through the existing storage path')
    const b = 'https://site-b.example',
      c = 'https://site-c.example'
    const backup = {
      hosts: [b, c],
      [b]: { source: 'window.site = "b"', config: { enable: true } },
      [c]: { source: 'window.site = "c"', config: { enable: true } },
    }
    assert.equal(
      (await send({ method: 'import', backup, replace: true })).imported,
      2,
    )
    await popup.goto(base + '#/?domain=' + encodeURIComponent(b))
    await popup.waitForSelector('#code-editor .monaco-editor')
    assert.equal(await get(), 'window.site = "b"')
    await set('window.site = "b draft"')
    await delay(650)
    await popup.goto(base + '#/?domain=' + encodeURIComponent(c))
    await popup.waitForSelector('#code-editor .monaco-editor')
    assert.equal(await get(), 'window.site = "c"')
    await popup.goto(base + '#/?domain=' + encodeURIComponent(b))
    await popup.waitForSelector('#code-editor .monaco-editor')
    assert.equal(await get(), 'window.site = "b draft"')
    ok('switching sites keeps their code and drafts separate')
    await set(
      'customjsReady(".card", element => {\n  element.style.borderRadius = "12px"\n  element.addEventListener("click", () => console.log("clicked"))\n})',
    )
    await popup.getByRole('button', { name: 'Format', exact: true }).click()
    await delay(300)
    await popup.screenshot({
      path: path.join(work, 'editor.png'),
      fullPage: true,
    })
    const targets = (await session.cdp.send('Target.getTargets')).targetInfos
      .filter((target) => target.type === 'worker' && target.url.includes(id))
      .map((target) => target.url)
    assert.ok(targets.some((url) => url.endsWith('/formatter.worker.js')))
    assert.ok(targets.some((url) => url.includes('monaco/ts.worker.js')))
    assert.equal(requests.length, 0)
    assert.deepEqual(errors, [])
    ok(
      'editor, language service and formatting work offline with packaged workers and no HTTP requests',
    )
    const result = {
      passed,
      workerUrls: targets,
      httpRequests: requests,
      pageErrors: errors,
      work,
    }
    fs.writeFileSync(
      path.join(work, 'results.json'),
      JSON.stringify(result, null, 2),
    )
    console.log('RESULTS', work)
  } catch (error) {
    console.log(
      'FAILURE TARGETS',
      JSON.stringify(
        (await session.cdp.send('Target.getTargets')).targetInfos.map(
          (target) => ({ type: target.type, url: target.url }),
        ),
      ),
    )
    const page = session.context
      .pages()
      .find((page) =>
        page
          .url()
          .startsWith('chrome-extension://fefpehedemediodnlhcpfhnbdhmihach/'),
      )
    if (page)
      await page
        .screenshot({ path: path.join(work, 'failure.png'), fullPage: true })
        .catch(() => {})
    console.log('FAILURE ARTIFACTS', work)
    throw error
  } finally {
    await session.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
