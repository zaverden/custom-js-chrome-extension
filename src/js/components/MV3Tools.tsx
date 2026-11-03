import React, { useEffect, useState } from 'react'
const send = (message) => chrome.runtime.sendMessage(message)
const download = (value) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  )
  const link = document.createElement('a')
  link.href = url
  link.download =
    'customjs-backup-' +
    new Date().toISOString().replace(/[:.]/g, '-') +
    '.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
export default function MV3Tools() {
  const [status, setStatus] = useState('Checking user scripts access...')
  const [backup, setBackup] = useState(null)
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async (fn) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setStatus(e.message)
    } finally {
      setBusy(false)
    }
  }
  const check = async () => {
    const result = await send({ method: 'apply' })
    setStatus(
      result.error || 'User scripts ready. Save applies on the next page load.'
    )
  }
  useEffect(() => {
    run(check)
  }, [])
  return (
    <div
      style={{
        padding: '6px 10px',
        borderBottom: '1px solid #ddd',
        background: '#f5f5f5',
        fontSize: 12,
      }}
    >
      <a href="#/list">All Hosts &amp; Patterns</a>{' '}
      <div role="status">{status}</div>
      <button disabled={busy} onClick={() => run(check)}>
        Check / Apply
      </button>{' '}
      <button
        disabled={busy}
        onClick={() =>
          run(async () => {
            const data = await send({ method: 'export' })
            if (data.error) throw Error(data.error)
            download(data)
          })
        }
      >
        Export backup
      </button>{' '}
      <button
        disabled={busy}
        onClick={() =>
          run(async () => {
            const r = await send({ method: 'refreshLibraries' })
            setStatus(r.error || 'Libraries refreshed; reload target pages.')
          })
        }
      >
        Refresh libraries
      </button>{' '}
      <label>
        Import JSON{' '}
        <input
          aria-label="Import JSON"
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) =>
            run(async () => {
              const file = e.target.files[0]
              if (!file) return
              if (file.size > 20000000) throw Error('Import file exceeds 20 MB')
              const value = JSON.parse(await file.text())
              if (!Array.isArray((value.data || value).hosts))
                throw Error('No hosts array in this file')
              setBackup(value)
              setStatus(
                'Selected backup: ' +
                  (value.data || value).hosts.length +
                  ' hosts. Review replacement before importing.'
              )
            })
          }
        />
      </label>
      {backup && (
        <>
          <label>
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
            />{' '}
            Replace matching hosts
          </label>{' '}
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const current = await send({ method: 'export' })
                if (current.error) throw Error(current.error)
                download(current)
                const r = await send({ method: 'import', backup, replace })
                if (r.error) throw Error(r.error)
                window.location.reload()
              })
            }
          >
            Import selected backup
          </button>
        </>
      )}
    </div>
  )
}
