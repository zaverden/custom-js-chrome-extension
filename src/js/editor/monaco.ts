import * as monaco from 'monaco-editor/editor/editor.api.js'
import { formatSource } from './format'
import * as typescript from 'monaco-editor/language/typescript/monaco.contribution.js'
import { cssDefaults } from 'monaco-editor/language/css/monaco.contribution.js'

// Explicit same-origin workers avoid blob/bootstrap loaders under the extension CSP.
;(globalThis as any).MonacoEnvironment = {
  ...(globalThis as any).MonacoEnvironment,
  getWorker(_moduleId: string, label: string) {
    const name =
      label === 'javascript' || label === 'typescript'
        ? 'ts'
        : label === 'css' || label === 'scss' || label === 'less'
          ? 'css'
          : 'editor'
    return new Worker(chrome.runtime.getURL(`monaco/${name}.worker.js`), {
      name: `custom-js-${label}`,
    })
  },
}
// Standard editor API for local troubleshooting and browser integration.
;(globalThis as any).monaco = monaco
const js = typescript.javascriptDefaults
js.setCompilerOptions({
  target: typescript.ScriptTarget.ESNext,
  allowNonTsExtensions: true,
  allowJs: true,
  checkJs: false,
  noEmit: true,
})
js.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
  noSuggestionDiagnostics: false,
})
js.setEagerModelSync(true)
js.setModeConfiguration({
  ...js.modeConfiguration,
  documentFormattingEdits: false,
  documentRangeFormattingEdits: false,
  onTypeFormattingEdits: false,
})
cssDefaults.setModeConfiguration({
  ...cssDefaults.modeConfiguration,
  documentFormattingEdits: false,
  documentRangeFormattingEdits: false,
})
js.addExtraLib(
  `
/** Calls the callback for existing and subsequently inserted matching elements. */
declare function customjsReady<E extends Element = HTMLElement>(selector: string, callback: (element: E) => void): void;
/** jQuery must be available on the page or selected in the library settings. */
interface CustomJSQuery {
  readonly length: number;
  hide(): CustomJSQuery; show(): CustomJSQuery; toggle(): CustomJSQuery;
  addClass(name: string): CustomJSQuery; removeClass(name: string): CustomJSQuery;
  css(property: string, value: string | number): CustomJSQuery;
  text(): string; text(value: string): CustomJSQuery;
  html(): string; html(value: string): CustomJSQuery;
  attr(name: string): string | undefined; attr(name: string, value: string): CustomJSQuery;
  on(event: string, handler: (event: Event) => void): CustomJSQuery;
  find(selector: string): CustomJSQuery; each(callback: (index: number, element: Element) => void): CustomJSQuery;
}
declare function $(selector: string | Element | Document | (() => void)): CustomJSQuery;
declare const jQuery: typeof $;
`,
  'inmemory://custom-js/globals.d.ts',
)

for (const language of ['javascript', 'css']) {
  monaco.languages.registerDocumentFormattingEditProvider(language, {
    async provideDocumentFormattingEdits(model) {
      const source = model.getValue(),
        version = model.getVersionId()
      let formatted: string
      try {
        formatted = await formatSource(source, language)
      } catch {
        return []
      }
      if (model.isDisposed() || model.getVersionId() !== version) return []
      return [{ range: model.getFullModelRange(), text: formatted }]
    },
  })
}
export { monaco }
