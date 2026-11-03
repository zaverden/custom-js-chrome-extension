import { action, computed, observable, makeObservable } from 'mobx'
import { encodeSource, decodeSource, getHosts, setHosts } from 'libs'
import isEqual from 'lodash.isequal'
import sizeof from 'object-sizeof'
import { js } from 'js-beautify'
import Store from 'stores'

type Host = { isRegex: boolean; pattern: string } | string

const key = 'popup'
const defaultSource = '// Here You can type your custom JavaScript...'

const getDomainKey = (host: Host) => {
  if (typeof host === 'object' && host.isRegex) {
    return `${key}-${host.pattern}`
  }
  return `${key}-${host}`
}

export default class AppStore {
  store: Store

  constructor(store) {
    makeObservable(this, {
      mode: observable,
      world: observable,
      loading: observable,
      autoSaveHandle: observable,
      saved: observable,
      hosts: observable,
      enable: observable,
      source: observable,
      draft: observable,
      truth: observable,
      tab: observable,
      host: observable,
      protocol: observable,
      matchedHost: observable,
      loadError: observable,
      error: observable,
      saveError: observable,
      include: computed,
      extra: computed,
      domain: computed,
      target: computed,
      differentURL: computed,
      tabMode: computed,
      customjs: computed,
      size: computed,
      domainKey: computed,
      init: action,
      saveDraft: action,
      removeDraft: action,
      beautify: action,
      onChangeSource: action,
      onRemoveDraft: action,
      toggleEnable: action,
      save: action,
      removeHost: action,
      goTo: action,
      clearSaveError: action,
      setMode: action,
    })

    this.store = store
  }

  mode = 'javascript'

  world = 'MAIN'

  loading = true

  autoSaveHandle = null

  saved = false

  hosts: Host[] = []

  enable = false

  source = defaultSource

  draft = null

  truth = null

  tab = { url: '' }

  host = ''

  protocol = ''

  matchedHost: Host = ''

  loadError = null

  error = null

  saveError = null

  get include() {
    return this.store.IncludeStore.include
  }

  get extra() {
    return this.store.IncludeStore.extra
  }

  get domain() {
    return `${this.protocol}//${this.host}`
  }

  get target() {
    if (typeof this.matchedHost === 'object' && this.matchedHost.isRegex) {
      return this.matchedHost.pattern
    }
    return this.domain
  }

  get differentURL() {
    return !this.tab.url.startsWith(this.domain)
  }

  get tabMode() {
    return this.tab.url === window.location.href
  }

  get customjs() {
    return {
      config: {
        enable: this.enable,
        include: this.include,
        extra: this.extra,
        world: this.world,
      },
      source: encodeSource(this.source),
    }
  }

  get size() {
    return sizeof(this.source)
  }

  get domainKey() {
    return getDomainKey(this.matchedHost)
  }

  init = ({ domain, isRegex, pattern }: any = {}) => {
    chrome.runtime.sendMessage(
      { method: 'getData', domain, isRegex, pattern },
      async (response) => {
        if (!response || typeof response.host !== 'string') {
          if (response?.error) {
            this.loadError = response.error
            return
          }
          throw new Error('Get no data for active tab!')
        }

        const { customjs, host, matchedHost, protocol, tab } = response
        Object.assign(this, {
          truth: customjs,
          host,
          matchedHost,
          protocol,
          tab,
        })

        this.hosts = await getHosts(key)
        this.loadDraft()

        if (!matchedHost) {
          if (isRegex) {
            this.error = `There is no pattern of "${pattern}"`
            return
          } else {
            this.hosts.push(this.domain)
            await this.saveHosts()
            return this.init({ domain, isRegex, pattern })
          }
        }

        if (isEqual(this.draft, this.truth)) {
          this.draft = null
        }
        this.loadCustomjs(this.draft || this.truth)
      }
    )
  }

  loadCustomjs = (customjs: any = { config: {} }) => {
    const {
      source = defaultSource,
      config: {
        enable = false,
        include = '',
        world = 'MAIN',
        extra = this.store.IncludeStore.placeholder,
      } = {},
    } = customjs
    Object.assign(this, { enable, world, source: decodeSource(source) })
    Object.assign(this.store.IncludeStore, { include, extra })
    this.error = ''
    this.loading = false
  }

  saveHosts = async (hosts = this.hosts) => {
    await setHosts(hosts.slice())
  }

  loadDraft = () => {
    const { draft } = JSON.parse(
      window.localStorage.getItem(this.domainKey) || '{}'
    )
    this.draft = draft
  }

  saveDraft = () => {
    this.draft = this.customjs
    window.localStorage.setItem(
      this.domainKey,
      JSON.stringify({ draft: this.draft })
    )
    this.saved = true
    this.autoSaveHandle = null
  }

  removeDraft = (domainKey = '') => {
    if (domainKey) {
      window.localStorage.removeItem(domainKey)
    } else {
      this.draft = null
      this.saved = false
      window.localStorage.removeItem(this.domainKey)
    }
  }

  beautify = () => {
    const value = js(this.source, { indent_size: 2 })
    this.onChangeSource(value)
  }

  onChangeSource = (value) => {
    this.source = value
    if (!this.enable) {
      this.enable = true
    }
    this.autoSave()
  }

  onRemoveDraft = () => {
    this.removeDraft()
    this.loadCustomjs(this.truth)
  }

  toggleEnable = () => {
    this.enable = !this.enable
    this.autoSave()
  }

  save = () => {
    const { domain, customjs, matchedHost } = this
    chrome.runtime.sendMessage(
      {
        method: 'setData',
        domain,
        matchedHost,
        customjs,
        reload: !this.tabMode,
      },
      (err) => {
        if (err) {
          this.saveError = err.error || err.message || String(err)
        } else {
          this.truth = customjs
          if (isEqual(customjs, this.customjs)) this.removeDraft()
          else this.saveDraft()
        }
      }
    )
  }

  removeHost = ({
    host = this.matchedHost,
    reload = false,
  }: { host?: Host; reload?: boolean } = {}) => {
    const message: any = { method: 'removeData', reload }
    if (typeof host === 'string') Object.assign(message, { domain: host })
    else Object.assign(message, host)
    chrome.runtime.sendMessage(message, (result) => {
      if (result?.error) {
        this.saveError = result.error
        return
      }
      this.hosts = this.hosts.filter(
        (x) => getDomainKey(x) !== getDomainKey(host)
      )
      this.loadCustomjs()
      this.removeDraft(getDomainKey(host))
    })
  }
  goTo = () => chrome.runtime.sendMessage({ method: 'goTo', link: this.domain })

  clearSaveError = () => {
    this.saveError = null
  }

  autoSave = () => {
    if (this.autoSaveHandle) {
      clearTimeout(this.autoSaveHandle)
    }
    this.autoSaveHandle = setTimeout(this.saveDraft, 500)
  }

  setMode = (mode) => {
    this.mode = mode
  }
}
