const { parse } = require('acorn')
const PREFIX = 'customjs-'
function decode(source = '') {
  if (typeof source !== 'string') throw new Error('Script source must be text')
  const b64 = 'data:text/javascript;base64,'
  const utf = 'data:text/javascript;charset=utf-8,'
  if (source.startsWith(b64)) return atob(source.slice(b64.length))
  if (source.startsWith(utf))
    return decodeURIComponent(source.slice(utf.length))
  return source
}
function hostKey(host) {
  if (
    typeof host === 'string' &&
    /^https?:\/\//.test(host) &&
    new URL(host).origin === host
  )
    return host
  if (
    host &&
    host.isRegex === true &&
    typeof host.pattern === 'string' &&
    host.pattern
  ) {
    new RegExp(host.pattern)
    return host.pattern
  }
  throw new Error('Invalid host or regular expression')
}
function validate(input) {
  const data =
    input?.data && Array.isArray(input.data.hosts) ? input.data : input
  if (!data || !Array.isArray(data.hosts))
    throw new Error('Expected an export with a hosts array')
  const result = { hosts: [] }
  for (const host of data.hosts) {
    const key = hostKey(host)
    if (
      ['hosts', '__proto__', 'constructor', 'prototype'].includes(key) ||
      key.startsWith('_mv3')
    )
      throw new Error('Reserved host key')
    if (result.hosts.some((h) => hostKey(h) === key)) continue
    const rule = data[key]
    result.hosts.push(host)
    if (!rule) continue
    if (!rule.config || typeof rule.config.enable !== 'boolean')
      throw new Error('Invalid script configuration: ' + key)
    decode(rule.source)
    const { enable, include = '', extra = '', world = 'MAIN' } = rule.config
    if (
      typeof include !== 'string' ||
      typeof extra !== 'string' ||
      !['MAIN', 'USER_SCRIPT'].includes(world)
    )
      throw new Error('Invalid library or world configuration')
    result[key] = {
      source: rule.source || '',
      config: { enable, include, extra, world },
    }
  }
  return result
}
function libraries(config) {
  const urls = []
  if (config.include) {
    if (!/^\/[a-zA-Z0-9_./-]+\.js$/.test(config.include))
      throw new Error('Invalid predefined library')
    urls.push('https://ajax.googleapis.com/ajax/libs' + config.include)
  }
  for (const line of (config.extra || '').split(/[;\r\n]+/)) {
    const value = line.trim()
    if (!value || value.startsWith('#')) continue
    const url = new URL(value.startsWith('//') ? 'https:' + value : value)
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error(
        'External libraries require HTTP(S) URLs without credentials'
      )
    urls.push(url.href)
  }
  return [...new Set(urls)]
}
function matchesHost(host, address) {
  const url = new URL(address)
  if (!['http:', 'https:'].includes(url.protocol)) return false
  return typeof host === 'string'
    ? url.origin === host
    : new RegExp(host.pattern).test(url.href)
}
function compile(data, cache, base) {
  const valid = validate(data)
  return valid.hosts.flatMap((host, index) => {
    const rule = valid[hostKey(host)]
    if (!rule?.config.enable) return []
    const deps = libraries(rule.config).map((url) => {
      if (typeof cache[url]?.code !== 'string')
        throw new Error('Library is not cached: ' + url)
      return cache[url].code
    })
    // Each source is a separate classic script: preserve directives and top-level scope.
    const sources = [base, ...deps, decode(rule.source)]
    const js = sources.map((code, part) => {
      parse(code, { ecmaVersion: 'latest', sourceType: 'script' })
      return {
        code:
          code +
          '\n;void 0;\n//# sourceURL=customjs-rule-' +
          index +
          '-part-' +
          part +
          '.js',
      }
    })
    return [{ id: PREFIX + index, host, world: rule.config.world, js }]
  })
}
module.exports = {
  PREFIX,
  decode,
  hostKey,
  validate,
  libraries,
  compile,
  matchesHost,
}
