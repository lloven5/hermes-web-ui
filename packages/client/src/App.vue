<script setup lang="ts">
import { onMounted, onUnmounted, computed, watch, ref } from 'vue'
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
const showLoading = ref(true)

const themeOverrides = computed(() => getThemeOverrides(isDark.value))
const naiveTheme = computed(() => isDark.value ? darkTheme : null)

const isLoginPage = computed(() => route.name === 'login')

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

// Stop showing loading once connected
watch(() => appStore.connected, (connected) => {
  if (connected) {
    showLoading.value = false
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
          <!-- Health check loading page -->
          <div v-if="showLoading && !isLoginPage" class="loading-view">
            <div class="loading-content">
              <img src="/sciclaw.png" alt="SciClaw" class="loading-logo" />
              <span class="loading-text">SciClaw</span>
            </div>
          </div>

          <div v-else class="app-layout" :class="{ 'no-sidebar': isLoginPage }">
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

.loading-view {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $bg-primary;
}

.loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.loading-logo {
  width: 72px;
  height: 72px;
  border-radius: 16px;
  object-fit: contain;
  animation: bounce 1.4s ease-in-out infinite;
}

.loading-text {
  font-size: 20px;
  font-weight: 600;
  color: $text-primary;
  animation: pulse 1.4s ease-in-out infinite;
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

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
  overflow-y: auto;
  background-color: $bg-primary;

  .no-sidebar & {
    height: calc(100 * var(--vh));
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
</style>

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
  overflow-y: auto;
  background-color: $bg-primary;

  .no-sidebar & {
    height: calc(100 * var(--vh));
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
</style>
