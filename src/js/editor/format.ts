let worker: Worker | undefined
let nextId = 1
const pending = new Map<
  number,
  {
    resolve: (text: string) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }
>()
const reset = (error: Error) => {
  worker?.terminate()
  worker = undefined
  for (const request of pending.values()) {
    clearTimeout(request.timer)
    request.reject(error)
  }
  pending.clear()
}
export function formatSource(
  source: string,
  language = 'javascript',
): Promise<string> {
  if (!worker) {
    worker = new Worker(chrome.runtime.getURL('formatter.worker.js'), {
      name: 'custom-js-formatter',
    })
    worker.onmessage = ({ data }) => {
      const request = pending.get(data.id)
      if (!request) return
      clearTimeout(request.timer)
      pending.delete(data.id)
      if (data.error) request.reject(new Error(data.error))
      else request.resolve(data.formatted)
    }
    worker.onerror = () =>
      reset(
        new Error(
          'The local formatter could not start. Reload the extension and try again.',
        ),
      )
  }
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reset(new Error('Formatting took too long. Your source was kept.')),
      15000,
    )
    pending.set(id, { resolve, reject, timer })
    worker.postMessage({ id, source, language })
  })
}
