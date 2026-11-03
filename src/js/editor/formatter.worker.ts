import { format } from 'prettier/standalone'
import * as babel from 'prettier/plugins/babel'
import * as estree from 'prettier/plugins/estree'
import * as postcss from 'prettier/plugins/postcss'

// Bundled worker: source stays in the extension and is never sent to a server.
const scope: any = self
scope.onmessage = async ({ data }) => {
  const { id, source, language } = data
  try {
    const formatted = await format(source, {
      parser: language === 'css' ? 'css' : 'babel',
      plugins: [babel, estree, postcss],
      semi: false,
      singleQuote: true,
      tabWidth: 2,
      printWidth: 90,
      trailingComma: 'none',
      embeddedLanguageFormatting: 'off',
    })
    scope.postMessage({ id, formatted })
  } catch (error) {
    scope.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
