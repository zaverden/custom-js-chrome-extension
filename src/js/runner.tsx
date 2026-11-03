// Only requests execution for this exact document. No user code crosses the page bridge.
chrome.runtime
  .sendMessage({ method: 'run' })
  .then((result) => {
    if (result?.error) console.warn('CustomJS:', result.error)
  })
  .catch((error) => console.warn('CustomJS:', error.message))
