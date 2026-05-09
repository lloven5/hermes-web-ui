<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { hasApiKey } from "@/api/client";
import { setAuthDisabled, setAuthChecked } from "@/router";
import { checkHealth } from "@/api/hermes/system";

const { t } = useI18n();
const router = useRouter();

const phase = ref<"checking" | "redirecting" | "error">("checking");
const errorMsg = ref("");
let checkCount = 0;

onMounted(async () => {
  await performHealthCheck();
});

async function performHealthCheck() {
  checkCount++;
  try {
    const res = await checkHealth();
    if (res && res.status === 'ok') {
      // 健康检查成功
      await handleAuthDecision();
      return;
    }
  } catch {
    // 单次失败，继续重试
  }
  
  // 如果检查次数小于3，继续重试
  if (checkCount < 3) {
    setTimeout(() => {
      performHealthCheck();
    }, 1000);
    return;
  }
  
  // 3次检查都失败，尝试直接跳转（auth disabled模式）
  await handleAuthDecision();
}

async function handleAuthDecision() {
  try {
    await checkHealth();
    setAuthDisabled(true);
    setAuthChecked(true);
    
    if (hasApiKey()) {
      router.replace("/hermes/chat");
    } else {
      router.replace("/login");
    }
  } catch {
    setAuthDisabled(true);
    setAuthChecked(true);
    if (hasApiKey()) {
      router.replace("/hermes/chat");
    } else {
      router.replace("/login");
    }
  }
}
</script>

<template>
  <div class="launch-view">
    <div class="launch-content">
      <div class="launch-logo">
        <img src="/sciclaw.png" alt="SciClaw" />
      </div>
      <h1 class="launch-title">SciClaw</h1>
      
      <div v-if="phase === 'checking'" class="launch-status checking">
        <span class="status-text">{{ t('launch.checking') }}</span>
        <div class="loading-dots">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>

      <div v-else-if="phase === 'error'" class="launch-status error">
        <span class="status-text">{{ t('launch.error') }}</span>
        <p class="error-hint">{{ errorMsg }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.launch-view {
  position: relative;
  height: calc(100 * var(--vh));
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: $bg-primary;
}

.launch-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  text-align: center;
}

.launch-logo {
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  
  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}

.launch-title {
  font-size: 32px;
  font-weight: 700;
  color: $text-primary;
  margin: 0;
  letter-spacing: 1px;
}

.launch-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-top: 20px;
  
  &.checking {
    .status-text {
      color: $text-muted;
      font-size: 14px;
    }
  }
  
  &.error {
    .status-text {
      color: $error;
      font-size: 14px;
    }
    
    .error-hint {
      color: $text-muted;
      font-size: 12px;
      margin: 0;
    }
  }
}

.loading-dots {
  display: flex;
  gap: 8px;
  
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: $accent-primary;
    animation: dotPulse 1.4s ease-in-out infinite;
    
    &:nth-child(1) {
      animation-delay: 0s;
    }
    
    &:nth-child(2) {
      animation-delay: 0.2s;
    }
    
    &:nth-child(3) {
      animation-delay: 0.4s;
    }
  }
}

@keyframes dotPulse {
  0%, 80%, 100% {
    transform: scale(0.6);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>