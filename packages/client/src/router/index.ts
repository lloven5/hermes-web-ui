import { createRouter, createWebHashHistory } from 'vue-router'
import { hasApiKey } from '@/api/client'

let authDisabled = true
let authChecked = false

export function setAuthDisabled(value: boolean) {
  authDisabled = value
}

export function isAuthDisabled(): boolean {
  return authDisabled
}

export function setAuthChecked(value: boolean) {
  authChecked = value
}

export function isAuthChecked(): boolean {
  return authChecked
}

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'launch',
      component: () => import('@/views/LaunchView.vue'),
      meta: { public: true },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/hermes/chat',
      name: 'hermes.chat',
      component: () => import('@/views/hermes/ChatView.vue'),
    },
    {
      path: '/hermes/history',
      name: 'hermes.history',
      component: () => import('@/views/hermes/HistoryView.vue'),
    },
    {
      path: '/hermes/jobs',
      name: 'hermes.jobs',
      component: () => import('@/views/hermes/JobsView.vue'),
    },
    {
      path: '/hermes/models',
      name: 'hermes.models',
      component: () => import('@/views/hermes/ModelsView.vue'),
    },
    {
      path: '/hermes/profiles',
      name: 'hermes.profiles',
      component: () => import('@/views/hermes/ProfilesView.vue'),
    },
    {
      path: '/hermes/logs',
      name: 'hermes.logs',
      component: () => import('@/views/hermes/LogsView.vue'),
    },
    {
      path: '/hermes/usage',
      name: 'hermes.usage',
      component: () => import('@/views/hermes/UsageView.vue'),
    },
    {
      path: '/hermes/skills',
      name: 'hermes.skills',
      component: () => import('@/views/hermes/SkillsView.vue'),
    },
    {
      path: '/hermes/memory',
      name: 'hermes.memory',
      component: () => import('@/views/hermes/MemoryView.vue'),
    },
    {
      path: '/hermes/settings',
      name: 'hermes.settings',
      component: () => import('@/views/hermes/SettingsView.vue'),
    },
    {
      path: '/hermes/gateways',
      name: 'hermes.gateways',
      component: () => import('@/views/hermes/GatewaysView.vue'),
    },
    {
      path: '/hermes/channels',
      name: 'hermes.channels',
      component: () => import('@/views/hermes/ChannelsView.vue'),
    },
    {
      path: '/hermes/terminal',
      name: 'hermes.terminal',
      component: () => import('@/views/hermes/TerminalView.vue'),
    },
    {
      path: '/hermes/group-chat',
      name: 'hermes.groupChat',
      component: () => import('@/views/hermes/GroupChatView.vue'),
    },
    {
      path: '/hermes/files',
      name: 'hermes.files',
      component: () => import('@/views/hermes/FilesView.vue'),
    },
  ],
})

router.beforeEach((to, _from, next) => {
  // Public pages don't need auth
  if (to.meta.public) {
    // If auth check is done and user can proceed, skip login/launch page
    if (to.name === 'login' && authChecked && (hasApiKey() || authDisabled)) {
      next({ path: '/hermes/chat' })
      return
    }
    next()
    return
  }

  // If auth not checked yet, always go to launch page first
  if (!authChecked) {
    if (to.name !== 'launch') {
      next({ name: 'launch' })
      return
    }
    next()
    return
  }

  // After auth checked: allow if auth disabled or has token
  if (authDisabled || hasApiKey()) {
    next()
    return
  }

  next({ name: 'login' })
})

export default router
