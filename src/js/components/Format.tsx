import React, { useState } from 'react'
import Button from '@material-ui/core/Button'
import { useStore } from './StoreContext'
import { observer } from 'mobx-react'
export default observer(() => {
  const { beautify } = useStore().AppStore
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <span>
      <Button
        color="primary"
        disabled={busy}
        title="Format with Prettier (Shift+Alt+F)"
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            await beautify()
          } catch (problem) {
            setError(
              problem instanceof Error ? problem.message : String(problem),
            )
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Formatting…' : 'Format'}
      </Button>
      {error && (
        <span role="alert" className="editor-format-error">
          {error}
        </span>
      )}
    </span>
  )
})
