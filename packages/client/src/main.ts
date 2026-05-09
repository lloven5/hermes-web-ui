import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router, { setAuthDisabled, setAuthChecked } from './router'
import { i18n } from './i18n'
import App from './App.vue'
import './styles/global.scss'

// Apply dark class before mount to prevent FOUC
const savedTheme = localStorage.getItem('hermes_theme') || 'system'
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
if (savedTheme === 'dark' || (savedTheme === 'system' && prefersDark)) {
  document.documentElement.classList.add('dark')
}

// Disable auth check - always go to main page directly
import { setApiKey } from '@/api/client'
const urlParams = new URLSearchParams(window.location.search)
const hashQuery = window.location.hash.split('?')[1]
const urlToken = urlParams.get('token') || (hashQuery ? new URLSearchParams(hashQuery).get('token') : null)
const storedKey = localStorage.getItem('hermes_api_key')
if (urlToken) {
  setApiKey(urlToken)
} else if (storedKey) {
  // Use stored key if exists
} else {
  // Generate a random token for anonymous access
  const anonToken = 'anonymous-' + Math.random().toString(36).substring(2, 15)
  setApiKey(anonToken)
}

// Disable auth and mark as checked - skip login page
setAuthDisabled(true)
setAuthChecked(true)

const app = createApp(App)
app.use(createPinia())
app.use(i18n)
app.use(router)
app.mount('#app')

// Redirect to main page if currently on login
if (window.location.hash === '#/' || window.location.hash === '' || window.location.hash === '#') {
  router.replace('/hermes/chat')
}
