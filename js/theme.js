const THEME_STORAGE_KEY = 'Stellar.theme'
const THEME_TRANSITION_CLASS = 'theme-transition'
const THEME_TRANSITION_DURATION = 300
let themeTransitionTimer = null

const normalizeTheme = (theme) => theme === 'dark' ? 'dark' : 'light'

const currentTheme = () => document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'

const syncThemeToggle = (theme) => {
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  const messages = window.__STELLAR_I18N__ || {}
  const label = messages[nextTheme] || (nextTheme === 'dark' ? '切换到深色模式' : '切换到浅色模式')
  document.querySelectorAll('[data-theme-toggle]').forEach((toggle) => {
    toggle.setAttribute('title', label)
    toggle.setAttribute('aria-label', label)
    toggle.setAttribute('data-next-theme', nextTheme)
    if (toggle.dataset.themeToggleBound !== 'true') {
      toggle.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          switchTheme()
        }
      })
      toggle.dataset.themeToggleBound = 'true'
    }
  })
}

const beginThemeTransition = () => {
  const root = document.documentElement
  root.classList.remove(THEME_TRANSITION_CLASS)
  // 强制浏览器先提交旧状态，随后 data-theme 的变化才会产生过渡。
  void root.offsetWidth
  root.classList.add(THEME_TRANSITION_CLASS)
  window.clearTimeout(themeTransitionTimer)
  themeTransitionTimer = window.setTimeout(() => {
    root.classList.remove(THEME_TRANSITION_CLASS)
  }, THEME_TRANSITION_DURATION)
}

const updateDarkMode = (theme) => {
  if (typeof utils === 'undefined' || !utils.dark?.method?.toggle) {
    return
  }
  utils.dark.mode = theme
  utils.dark.method.toggle.start()
}

const applyTheme = (theme, options = {}) => {
  const nextTheme = normalizeTheme(theme)
  if (options.animate) {
    beginThemeTransition()
  }
  document.documentElement.setAttribute('data-theme', nextTheme)
  syncThemeToggle(nextTheme)
  applyThemeToGiscus(nextTheme)
  return nextTheme
}

const applyThemeToGiscus = (theme) => {
  const cmt = document.getElementById('giscus')
  if (cmt) {
    // This works before giscus load.
    cmt.setAttribute('data-theme', theme)
  }

  const iframe = document.querySelector('#comments > section.giscus > iframe')
  if (iframe) {
    // This works after giscus loaded.
    const src = iframe.src
    const newSrc = src.replace(/theme=[\w]+/, `theme=${theme}`)
    iframe.src = newSrc
  }
}

const switchTheme = () => {
  const newTheme = applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', { animate: true })
  window.localStorage.setItem(THEME_STORAGE_KEY, newTheme)
  updateDarkMode(newTheme)

  const messages = window.__STELLAR_I18N__ || {}
  if (typeof hud !== 'undefined' && typeof hud.toast === 'function') {
    hud.toast(messages[newTheme])
  }
}

(() => {
  // 仅接受 light / dark；旧版本留下的 auto 值会被规范化为当前配置的模式。
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  const configuredTheme = normalizeTheme(document.documentElement.getAttribute('data-theme'))
  const initialTheme = savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : configuredTheme
  const theme = applyTheme(initialTheme)
  if (savedTheme !== null && savedTheme !== 'light' && savedTheme !== 'dark') {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }
  updateDarkMode(theme)
})()
