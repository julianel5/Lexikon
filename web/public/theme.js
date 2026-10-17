// Applies the saved (or system) theme before first paint to avoid a flash of
// the wrong theme. index.html loads this with a blocking script on purpose:
// an inline script would be blocked by the CSP (script-src 'self'), and a
// deferred/module script would run too late and flash.
(function () {
  try {
    var saved = localStorage.getItem('lexikon-theme')
    var theme =
      saved === 'light' || saved === 'dark'
        ? saved
        : window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
    document.documentElement.setAttribute('data-theme', theme)
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark')
  }
})()
