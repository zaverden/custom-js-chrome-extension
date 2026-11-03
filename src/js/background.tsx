import {
  getHostKey,
  findMatchedHosts,
  getActiveTab,
  setLastFocusedWindowId,
} from 'libs'
import { validate, libraries, compile, matchesHost } from './mv3/core'
const SETUP =
  'Enable developer mode and Allow user scripts for this extension at browser://extensions, then click Check / Apply.'
let queue: Promise<unknown> = Promise.resolve()
let prepared = []
let basePromise: Promise<string>
const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
  const next = queue.then(() => fn())
  queue = next.catch(() => {})
  return next
}
const errorText = (e) => (e instanceof Error ? e.message : String(e))
const getAPI = async () => {
  const api = (chrome as any).userScripts
  if (!api) throw new Error(SETUP)
  try {
    await api.getScripts()
  } catch (e) {
    throw new Error(SETUP + ' ' + errorText(e))
  }
  return api
}
const setStatus = async (error = '') => {
  await chrome.storage.local.set({
    _mv3Status: { error, checkedAt: new Date().toISOString() },
  })
  await chrome.action.setBadgeText({ text: error ? '!' : '' })
  if (error) await chrome.action.setBadgeBackgroundColor({ color: '#b71c1c' })
}
async function cacheLibraries(data, refresh = false) {
  const { _mv3Libraries = {} } = await chrome.storage.local.get('_mv3Libraries')
  const cache = { ..._mv3Libraries }
  const urls = [
    ...new Set(
      data.hosts.flatMap((h) =>
        data[getHostKey(h)]?.config.enable
          ? libraries(data[getHostKey(h)].config)
          : []
      )
    ),
  ] as string[]
  for (const url of urls) {
    if (!refresh && typeof cache[url]?.code === 'string') continue
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const code = await response.text()
      if (code.length > 5000000) throw new Error('Library exceeds 5 MB')
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(code)
      )
      const sha256 = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, '0')
      ).join('')
      cache[url] = { code, sha256, fetchedAt: new Date().toISOString() }
    } catch (e) {
      throw new Error(
        `Cannot download ${url}: ${errorText(e)}. Existing scripts were kept.`
      )
    } finally {
      clearTimeout(timer)
    }
  }
  return cache
}
async function prepareData(data, cache) {
  const api = await getAPI()
  if (typeof api.execute !== 'function')
    throw new Error(
      'This browser does not provide chrome.userScripts.execute; use the tested Yandex version.'
    )
  if (!basePromise)
    basePromise = fetch(chrome.runtime.getURL('base.js')).then((response) =>
      response.text()
    )
  const desired = compile(data, cache, await basePromise)
  await api.configureWorld({
    csp: "script-src 'self' 'unsafe-eval'; object-src 'self'",
  })
  // Clear persistent registrations from earlier development builds of this fork.
  if ((await api.getScripts()).length) await api.unregister()
  return desired
}
async function runForSender(sender) {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.tab?.id ||
    !sender.documentId ||
    !/^https?:\/\//.test(sender.url || '')
  )
    throw new Error('Invalid script execution request')
  const selected = await serial(async () =>
    prepared.filter((script) => matchesHost(script.host, sender.url))
  )
  if (!selected.length) return { executed: 0 }
  const api = await getAPI()
  const errors = []
  // User code may display a dialog or run slowly; never hold the editor's mutation queue.
  for (const script of selected) {
    try {
      const results = await api.execute({
        target: { tabId: sender.tab.id, documentIds: [sender.documentId] },
        world: script.world,
        js: script.js,
      })
      for (const result of results)
        if (result.error) errors.push(String(result.error))
    } catch (e) {
      errors.push(errorText(e))
    }
  }
  return { executed: selected.length, error: errors.join('\n') }
}
const reconcile = () =>
  serial(async () => {
    try {
      const data = validate({
        hosts: [],
        ...(await chrome.storage.local.get()),
      })
      const { _mv3Libraries = {} } = await chrome.storage.local.get(
        '_mv3Libraries'
      )
      prepared = await prepareData(data, _mv3Libraries)
      await setStatus()
    } catch (e) {
      await setStatus(errorText(e))
    }
  })
async function saveData(data, refresh = false) {
  const valid = validate(data)
  const cache = await cacheLibraries(valid, refresh)
  const next = await prepareData(valid, cache)
  await chrome.storage.local.set({ ...valid, _mv3Libraries: cache })
  prepared = next
  await setStatus()
}
async function handle(message, sender) {
  if (message?.method === 'run') return runForSender(sender)
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(chrome.runtime.getURL(''))
  )
    throw new Error('Only extension pages may edit scripts')
  const { method } = message
  if (method === 'status') {
    let error = ''
    try {
      await getAPI()
    } catch (e) {
      error = errorText(e)
    }
    const { _mv3Status } = await chrome.storage.local.get('_mv3Status')
    return {
      error: error || _mv3Status?.error || '',
      version: chrome.runtime.getManifest().version,
    }
  }
  if (method === 'apply') {
    await reconcile()
    return handle({ method: 'status' }, sender)
  }
  if (method === 'export') {
    const all = await chrome.storage.local.get()
    return {
      format: 'customjs-mv3',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: validate({ hosts: [], ...all }),
    }
  }
  if (method === 'import')
    return serial(async () => {
      const incoming = validate(message.backup)
      const current = validate({
        hosts: [],
        ...(await chrome.storage.local.get()),
      })
      const conflicts = incoming.hosts.filter((h) =>
        current.hosts.some((c) => getHostKey(c) === getHostKey(h))
      )
      if (conflicts.length && !message.replace)
        throw new Error(
          'Matching hosts already exist. Enable replacement to import them.'
        )
      await chrome.storage.local.set({
        _mv3BeforeImport: {
          createdAt: new Date().toISOString(),
          data: current,
        },
      })
      const hosts = [
        ...current.hosts.filter(
          (c) => !incoming.hosts.some((h) => getHostKey(c) === getHostKey(h))
        ),
        ...incoming.hosts,
      ]
      await saveData({ ...current, ...incoming, hosts })
      return { imported: incoming.hosts.length }
    })
  if (method === 'refreshLibraries')
    return serial(async () => {
      await saveData({ hosts: [], ...(await chrome.storage.local.get()) }, true)
      return {}
    })
  if (method === 'removeData')
    return serial(async () => {
      const key = message.isRegex
        ? message.pattern
        : new URL(message.domain).origin
      const data = { hosts: [], ...(await chrome.storage.local.get()) }
      data.hosts = data.hosts.filter((h) => getHostKey(h) !== key)
      delete data[key]
      await saveData(data)
      await chrome.storage.local.remove(key)
      if (message.reload) await chrome.tabs.reload((await getActiveTab()).id)
      return null
    })
  const tab = message.tabId
    ? await chrome.tabs.get(message.tabId)
    : await getActiveTab()
  const url = new URL(message.domain || tab.url)
  if (
    method === 'getData' &&
    !message.isRegex &&
    !['http:', 'https:'].includes(url.protocol)
  )
    throw new Error(
      'Open a regular HTTP(S) page, then click the extension icon. Saved hosts are available via All Hosts & Patterns.'
    )
  if (method === 'getData') {
    const data = await chrome.storage.local.get()
    const matchedHost = findMatchedHosts(data.hosts || [], url, message)[0]
    return {
      host: url.host,
      protocol: url.protocol,
      tab,
      matchedHost,
      customjs: matchedHost ? data[getHostKey(matchedHost)] : undefined,
    }
  }
  if (method === 'setData')
    return serial(async () => {
      const data = { hosts: [], ...(await chrome.storage.local.get()) }
      const key = getHostKey(message.matchedHost)
      if (!data.hosts.some((h) => getHostKey(h) === key))
        data.hosts.push(message.matchedHost)
      await saveData({ ...data, [key]: message.customjs })
      if (message.reload) await chrome.tabs.reload(tab.id)
      return null
    })
  if (method === 'goTo') {
    await chrome.tabs.update(tab.id, { url: message.link })
    return null
  }
  throw new Error('Unknown method: ' + method)
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(respond, (e) => respond({ error: errorText(e) }))
  return true
})
chrome.windows.onFocusChanged.addListener((id) => {
  if (id >= 0) setLastFocusedWindowId(id)
})
chrome.runtime.onInstalled.addListener(() => {
  reconcile()
})
chrome.runtime.onStartup.addListener(() => {
  reconcile()
})
reconcile()
