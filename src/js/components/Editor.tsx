import React, { useEffect, useRef, useState } from 'react'
import { observer } from 'mobx-react'
import { useStore } from './StoreContext'
import { monaco } from '../editor/monaco'
import { formatSource } from '../editor/format'

type Preferences = { theme: 'vs' | 'vs-dark'; fontSize: number; wrap: boolean }
const preferenceKey = 'customjs-editor-preferences'
function modelFileName(key: string) {
  let hash = 2166136261
  for (let i = 0; i < key.length; i++)
    hash = Math.imul(hash ^ key.charCodeAt(i), 16777619)
  return 'inmemory://custom-js/script-' + (hash >>> 0).toString(16) + '.js'
}
function loadPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) || '{}')
    return {
      theme: value.theme === 'vs-dark' ? 'vs-dark' : 'vs',
      fontSize: [12, 14, 16, 18, 20].includes(value.fontSize)
        ? value.fontSize
        : 14,
      wrap: value.wrap !== false,
    }
  } catch {
    return { theme: 'vs', fontSize: 14, wrap: true }
  }
}
export default observer(() => {
  const { AppStore } = useStore()
  const { source, mode, domainKey, onChangeSource, save } = AppStore
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor>()
  const latest = useRef({ onChangeSource, save })
  latest.current = { onChangeSource, save }
  const syncing = useRef(false)
  const [preferences, setPreferences] = useState(loadPreferences)
  const [position, setPosition] = useState({ lineNumber: 1, column: 1 })
  const [formatError, setFormatError] = useState('')

  useEffect(() => {
    const model = monaco.editor.createModel(
      source,
      mode,
      monaco.Uri.parse(modelFileName(domainKey)),
    )
    const instance = monaco.editor.create(container.current, {
      model,
      theme: preferences.theme,
      fontSize: preferences.fontSize,
      fontFamily: 'Consolas, "Courier New", monospace',
      automaticLayout: true,
      minimap: { enabled: false },
      wordWrap: preferences.wrap ? 'on' : 'off',
      tabSize: 2,
      insertSpaces: true,
      scrollBeyondLastLine: false,
      padding: { top: 10, bottom: 10 },
      quickSuggestions: { other: true, comments: false, strings: false },
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: 'smart',
      parameterHints: { enabled: true },
      tabCompletion: 'on',
      snippetSuggestions: 'top',
      autoClosingBrackets: 'languageDefined',
      autoClosingQuotes: 'languageDefined',
      bracketPairColorization: { enabled: true },
      accessibilitySupport: 'auto',
      ariaLabel: 'Code editor',
    })
    editor.current = instance
    const changes = instance.onDidChangeModelContent(() => {
      if (!syncing.current) {
        setFormatError('')
        latest.current.onChangeSource(instance.getValue())
      }
    })
    const cursor = instance.onDidChangeCursorPosition((event) =>
      setPosition(event.position),
    )
    instance.addAction({
      id: 'custom-js.save',
      label: 'Save script',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => latest.current.save(),
    })
    instance.addAction({
      id: 'custom-js.format',
      label: 'Format code with Prettier',
      keybindings: [
        monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
      ],
      async run() {
        const version = model.getVersionId(),
          value = model.getValue()
        try {
          const formatted = await formatSource(value, model.getLanguageId())
          if (model.isDisposed() || model.getVersionId() !== version) return
          instance.pushUndoStop()
          instance.executeEdits('custom-js.format', [
            { range: model.getFullModelRange(), text: formatted },
          ])
          instance.pushUndoStop()
          setFormatError('')
        } catch (error) {
          setFormatError(error instanceof Error ? error.message : String(error))
        }
      },
    })
    return () => {
      changes.dispose()
      cursor.dispose()
      instance.dispose()
      model.dispose()
      editor.current = undefined
    }
  }, [])

  useEffect(() => {
    const instance = editor.current,
      model = instance?.getModel()
    if (!model || model.getValue() === source) return
    const view = instance.saveViewState()
    syncing.current = true
    instance.pushUndoStop()
    instance.executeEdits('custom-js.sync', [
      { range: model.getFullModelRange(), text: source },
    ])
    instance.pushUndoStop()
    syncing.current = false
    if (view) instance.restoreViewState(view)
  }, [source])
  useEffect(() => {
    const model = editor.current?.getModel()
    if (model) monaco.editor.setModelLanguage(model, mode)
  }, [mode])
  useEffect(() => {
    localStorage.setItem(preferenceKey, JSON.stringify(preferences))
    monaco.editor.setTheme(preferences.theme)
    editor.current?.updateOptions({
      fontSize: preferences.fontSize,
      wordWrap: preferences.wrap ? 'on' : 'off',
    })
  }, [preferences])

  return (
    <div className="code-editor-shell">
      <div className="code-editor-tools">
        <span>{mode === 'css' ? 'CSS hints' : 'JavaScript & DOM hints'}</span>
        <div>
          <label>
            Theme{' '}
            <select
              aria-label="Editor theme"
              value={preferences.theme}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  theme: event.target.value as Preferences['theme'],
                })
              }
            >
              <option value="vs">Light</option>
              <option value="vs-dark">Dark</option>
            </select>
          </label>
          <label>
            Font{' '}
            <select
              aria-label="Editor font size"
              value={preferences.fontSize}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  fontSize: Number(event.target.value),
                })
              }
            >
              {[12, 14, 16, 18, 20].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-pressed={preferences.wrap}
            onClick={() =>
              setPreferences({ ...preferences, wrap: !preferences.wrap })
            }
          >
            Word wrap
          </button>
        </div>
      </div>
      <div ref={container} id="code-editor" className="code-editor-surface" />
      {formatError && (
        <div role="alert" className="editor-format-error">
          {formatError}
        </div>
      )}
      <div className="code-editor-status">
        <span>
          {mode === 'css' ? 'CSS' : 'JavaScript'} · Ln {position.lineNumber},
          Col {position.column} · Spaces: 2
        </span>
        <span>Ctrl+Space hints · Shift+Alt+F format · Ctrl+S save</span>
      </div>
    </div>
  )
})
