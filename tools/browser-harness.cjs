const fs = require('fs'),
  path = require('path'),
  { spawn } = require('child_process')
const { chromium } = require('playwright-core')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function launch(profile) {
  fs.mkdirSync(profile, { recursive: true })
  const portFile = path.join(profile, 'DevToolsActivePort')
  try {
    fs.unlinkSync(portFile)
  } catch {}
  const executable =
    process.env.YANDEX_BROWSER ||
    'C:\\Program Files (x86)\\Yandex\\YandexBrowser\\Application\\browser.exe'
  const processHandle = spawn(
    executable,
    [
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--enable-unsafe-extension-debugging',
      '--user-data-dir=' + profile,
      '--no-first-run',
      'about:blank',
    ],
    { stdio: 'ignore' }
  )
  let browser
  try {
    let port
    for (let i = 0; i < 100; i++) {
      try {
        port = fs.readFileSync(portFile, 'utf8').split('\n')[0]
        break
      } catch {}
      await delay(200)
    }
    if (!port) throw Error('Yandex debugging endpoint did not appear')
    browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, {
      timeout: 15000,
    })
    const context = browser.contexts()[0]
    const manager = await context.newPage()
    await manager.goto('chrome://extensions/')
    await manager.evaluate(() =>
      chrome.developerPrivate.updateProfileConfiguration({
        inDeveloperMode: true,
      })
    )
    const cdp = await browser.newBrowserCDPSession()
    return {
      browser,
      context,
      manager,
      cdp,
      processHandle,
      async close() {
        const exited = new Promise((r) => processHandle.once('exit', r))
        await cdp.send('Browser.close').catch(() => {})
        await Promise.race([exited, delay(8000)])
      },
    }
  } catch (e) {
    if (browser) await browser.close()
    processHandle.kill()
    throw e
  }
}
async function load(session, extension, allow = true) {
  const { id } = await session.cdp.send('Extensions.loadUnpacked', {
    path: extension,
  })
  await delay(500)
  await session.manager.evaluate(
    async ({ id, allow }) => {
      await chrome.developerPrivate.updateExtensionConfiguration({
        extensionId: id,
        userScriptsAccess: allow,
        hostAccess: 'ON_ALL_SITES',
      })
    },
    { id, allow }
  )
  return id
}
module.exports = { launch, load, delay }
