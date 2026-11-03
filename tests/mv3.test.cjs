const test = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm')
const {
  decode,
  validate,
  libraries,
  compile,
  matchesHost,
} = require('../src/js/mv3/core')
const origin = 'https://example.test'
const rule = (source, config = {}) => ({
  source,
  config: { enable: true, ...config },
})
test('legacy encodings and Unicode survive', () => {
  assert.equal(
    decode('data:text/javascript;base64,' + btoa('var x = 1')),
    'var x = 1'
  )
  assert.equal(
    decode(
      'data:text/javascript;charset=utf-8,' + encodeURIComponent('Привет 🌍')
    ),
    'Привет 🌍'
  )
  assert.equal(decode(''), '')
})
test('import validates every rule before writing', () => {
  assert.throws(() => validate({ hosts: [{ isRegex: true, pattern: '[' }] }))
  assert.throws(() => validate({ hosts: [origin], [origin]: rule(10) }))
  assert.throws(() =>
    validate({ hosts: [origin], [origin]: rule('', { world: 'bad' }) })
  )
  assert.throws(() =>
    validate({ hosts: [{ isRegex: true, pattern: '__proto__' }] })
  )
})
test('library order, comments, multiline URLs and deduplication', () => {
  assert.deepEqual(
    libraries({
      include: '/jquery/3.2.1/jquery.min.js',
      extra:
        '# skip; //example.test/a.js\nhttps://example.test/a.js;https://example.test/b.js',
    }),
    [
      'https://ajax.googleapis.com/ajax/libs/jquery/3.2.1/jquery.min.js',
      'https://example.test/a.js',
      'https://example.test/b.js',
    ]
  )
  assert.throws(() => libraries({ extra: 'data:text/javascript,alert(1)' }))
})
test('exact origin, ports, regex and restricted page matching happen outside user code', () => {
  assert.equal(
    matchesHost('https://example.test:8443', 'https://example.test:8443/path'),
    true
  )
  assert.equal(
    matchesHost('https://example.test:8443', origin + '/path'),
    false
  )
  assert.equal(
    matchesHost({ isRegex: true, pattern: '/wanted$' }, origin + '/wanted'),
    true
  )
  assert.equal(
    matchesHost({ isRegex: true, pattern: '.*' }, 'chrome://extensions'),
    false
  )
})
test('separate classic scripts preserve dependency order, strict directives and global lexical scope', () => {
  const data = {
    hosts: [origin],
    [origin]: rule(
      '"use strict"; let lexical = 17; window.result = [dep, base, (function(){return this})()];',
      { extra: 'https://example.test/lib.js' }
    ),
  }
  const [script] = compile(
    data,
    { 'https://example.test/lib.js': { code: 'var dep = 2' } },
    'var base = 1'
  )
  const context = vm.createContext({ window: {} })
  for (const source of script.js) vm.runInContext(source.code, context)
  assert.deepEqual(Array.from(context.window.result), [2, 1, undefined])
  assert.equal(vm.runInContext('lexical', context), 17)
  assert.throws(() => compile(data, {}, ''))
})
test('disabled rules produce no executable sources', () => {
  assert.deepEqual(
    compile(
      { hosts: [origin], [origin]: rule('throw Error()', { enable: false }) },
      {},
      ''
    ),
    []
  )
})
test('syntax errors cannot escape URL guards or alter existing data', () => {
  assert.throws(() =>
    compile(
      { hosts: [origin], [origin]: rule('}; var escaped=1; if(true){') },
      {},
      ''
    )
  )
  assert.throws(() =>
    compile({ hosts: [origin], [origin]: rule('var = ;') }, {}, '')
  )
})
