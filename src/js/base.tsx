// inspired by http://ryanmorr.com/using-mutation-observers-to-watch-for-element-availability/
const listeners = []
const doc = window.document

let observer = null

const check = () => {
  // Check the DOM for elements matching a stored selector
  listeners.forEach((listener) => {
    const elements = doc.querySelectorAll(listener.selector)
    elements.forEach((ele) => {
      if (!ele.ready) {
        ele.ready = true
        listener.fn.call(ele, ele)
      }
    })
  })
}

const ready = (selector, fn) => {
  // Store the selector and callback to be monitored
  listeners.push({
    selector: selector,
    fn: fn,
  })
  if (!observer) {
    // Watch for changes in the document
    observer = new window.MutationObserver(check)
    observer.observe(doc.documentElement, {
      childList: true,
      subtree: true,
    })
  }
  // Check if the element is currently in the DOM
  check()
}

// Expose `ready`
;(window as any).customjsReady = ready
