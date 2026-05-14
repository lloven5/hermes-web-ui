<script setup lang="ts">
import { onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { darkTheme, NConfigProvider, NMessageProvider, NDialogProvider, NNotificationProvider } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { getThemeOverrides } from '@/styles/theme'
import { useTheme } from '@/composables/useTheme'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import { useKeyboard } from '@/composables/useKeyboard'
import { useAppStore } from '@/stores/hermes/app'
import SessionSearchModal from '@/components/hermes/chat/SessionSearchModal.vue'

const { isDark } = useTheme()
const { t } = useI18n()
const appStore = useAppStore()
const route = useRoute()

const themeOverrides = computed(() => getThemeOverrides(isDark.value))
const naiveTheme = computed(() => isDark.value ? darkTheme : null)

const isLoginPage = computed(() => route.name === 'login' || route.name === 'launch')

const nodeVersionLow = computed(() => {
  const v = appStore.nodeVersion
  const major = parseInt(v.split('.')[0], 10)
  return !isNaN(major) && major < 23
})

// Close mobile sidebar on route change
watch(() => route.path, () => {
  appStore.closeSidebar()
})

onMounted(() => {
  if (!isLoginPage.value) {
    appStore.loadModels()
    appStore.startHealthPolling()
  }
})

onUnmounted(() => {
  appStore.stopHealthPolling()
})

useKeyboard()
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <NMessageProvider>
      <NDialogProvider>
        <NNotificationProvider>
          <div class="app-layout" :class="{ 'no-sidebar': isLoginPage, 'sidebar-collapsed': appStore.sidebarCollapsed }">
            <div v-if="nodeVersionLow" class="node-warning-bar">
              {{ t('sidebar.nodeVersionWarning', { version: appStore.nodeVersion }) }}
            </div>
            <button v-if="!isLoginPage" class="hamburger-btn" @click="appStore.toggleSidebar">
              <img src="/logo.png" alt="Menu" style="width: 24px; height: 24px;" />
            </button>
            <div v-if="!isLoginPage && appStore.sidebarOpen" class="mobile-backdrop" @click="appStore.closeSidebar" />
            <AppSidebar v-if="!isLoginPage" />
            <main class="app-main">
              <router-view />
            </main>
          </div>
          <SessionSearchModal />
        </NNotificationProvider>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.app-layout {
  display: flex;
  height: calc(100 * var(--vh));
  width: 100vw;
  overflow: hidden;
  position: relative;

  &.no-sidebar {
    display: block;
  }
}

.app-main {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background-color: $bg-primary;
  margin-left: $sidebar-width;
  transition: margin-left $transition-fast;

  .sidebar-collapsed & {
    margin-left: $sidebar-collapsed-width;
  }

  .no-sidebar & {
    height: calc(100 * var(--vh));
    margin-left: 0;
  }
}

.node-warning-bar {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  z-index: 100;
  padding: 4px 16px;
  font-size: 12px;
  font-weight: 500;
  color: #b45309;
  background-color: #fef3c7;
  border-bottom: 1px solid #fde68a;
  text-align: center;
  line-height: 1.4;
}

@media (max-width: $breakpoint-mobile) {
  .app-main,
  .app-layout.sidebar-collapsed .app-main {
    margin-left: 0;
  }
}
</style>
