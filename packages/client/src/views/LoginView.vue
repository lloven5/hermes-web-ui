<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { setApiKey, hasApiKey } from "@/api/client";
import { fetchAuthStatus, loginWithPassword } from "@/api/auth";
import { setAuthDisabled, setAuthChecked } from "@/router";

const { t } = useI18n();
const router = useRouter();

const phase = ref<"loading" | "login" | "redirecting">("loading");
const urlToken = (window as any).__LOGIN_TOKEN__ || "";
const token = ref(urlToken);
const username = ref("");
const password = ref("");
const loading = ref(false);
const errorMsg = ref("");
const loginMethod = ref<"token" | "password">("token");
const hasPasswordLogin = ref(false);

onMounted(async () => {
  try {
    const status = await fetchAuthStatus();
    if (status.authDisabled) {
      setAuthDisabled(true);
      setAuthChecked(true);
      phase.value = "redirecting";
      setTimeout(() => router.replace("/hermes/chat"), 800);
      return;
    }
    setAuthDisabled(false);
    if (hasApiKey()) {
      setAuthChecked(true);
      phase.value = "redirecting";
      setTimeout(() => router.replace("/hermes/chat"), 800);
      return;
    }
    hasPasswordLogin.value = status.hasPasswordLogin;
    if (status.hasPasswordLogin && !urlToken) {
      loginMethod.value = "password";
    }
    setAuthChecked(true);
    phase.value = "login";
  } catch {
    setAuthDisabled(true);
    setAuthChecked(true);
    phase.value = "redirecting";
    setTimeout(() => router.replace("/hermes/chat"), 800);
  }
});

async function handleLogin() {
  if (loginMethod.value === "token") {
    await handleTokenLogin();
  } else {
    await handlePasswordLogin();
  }
}

async function handleTokenLogin() {
  const key = token.value.trim();
  if (!key) {
    errorMsg.value = t("login.tokenRequired");
    return;
  }

  loading.value = true;
  errorMsg.value = "";

  try {
    const res = await fetch("/api/hermes/sessions", {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (res.status === 401) {
      errorMsg.value = t("login.invalidToken");
      loading.value = false;
      return;
    }

    setApiKey(key);
    setAuthChecked(true);
    phase.value = "redirecting";
    setTimeout(() => router.replace("/hermes/chat"), 600);
  } catch {
    errorMsg.value = t("login.connectionFailed");
  } finally {
    loading.value = false;
  }
}

async function handlePasswordLogin() {
  if (!username.value.trim() || !password.value) {
    errorMsg.value = t("login.credentialsRequired");
    return;
  }

  loading.value = true;
  errorMsg.value = "";

  try {
    const sessionToken = await loginWithPassword(username.value.trim(), password.value);
    setApiKey(sessionToken);
    setAuthChecked(true);
    phase.value = "redirecting";
    setTimeout(() => router.replace("/hermes/chat"), 600);
  } catch (err: any) {
    errorMsg.value = err.message || t("login.invalidCredentials");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="launch-view">
    <!-- Ambient background -->
    <div class="launch-bg">
      <div class="orb orb-1" />
      <div class="orb orb-2" />
      <div class="orb orb-3" />
    </div>

    <div class="launch-content" :class="phase">
      <!-- Logo -->
      <div class="launch-logo">
        <div class="logo-ring">
          <img src="/sciclaw.png" alt="SciClaw" class="logo-img" />
        </div>
      </div>

      <!-- Brand -->
      <h1 class="launch-title">SciClaw</h1>
      <p class="launch-subtitle">{{ phase === 'loading' ? t('login.loading') : phase === 'redirecting' ? t('login.redirecting') : t('login.description') }}</p>

      <!-- Loading spinner -->
      <div v-if="phase === 'loading' || phase === 'redirecting'" class="launch-spinner">
        <div class="spinner-track">
          <div class="spinner-fill" />
        </div>
      </div>

      <!-- Login form (only when auth is required) -->
      <Transition name="form-fade">
        <form v-if="phase === 'login'" class="login-form" @submit.prevent="handleLogin">
          <div v-if="hasPasswordLogin" class="login-method-toggle">
            <button
              type="button"
              class="toggle-btn"
              :class="{ active: loginMethod === 'password' }"
              @click="loginMethod = 'password'"
            >{{ t("login.passwordLogin") }}</button>
            <button
              type="button"
              class="toggle-btn"
              :class="{ active: loginMethod === 'token' }"
              @click="loginMethod = 'token'"
            >{{ t("login.tokenLogin") }}</button>
          </div>

          <template v-if="loginMethod === 'token'">
            <input
              v-model="token"
              type="password"
              class="login-input"
              :placeholder="t('login.placeholder')"
              autofocus
            />
          </template>

          <template v-if="loginMethod === 'password'">
            <input
              v-model="username"
              type="text"
              class="login-input"
              :placeholder="t('login.usernamePlaceholder')"
              autofocus
            />
            <input
              v-model="password"
              type="password"
              class="login-input"
              :placeholder="t('login.passwordPlaceholder')"
              @keyup.enter="handleLogin"
            />
          </template>

          <div v-if="errorMsg" class="login-error">{{ errorMsg }}</div>
          <button type="submit" class="login-btn" :disabled="loading">
            {{ loading ? "..." : t("login.submit") }}
          </button>
        </form>
      </Transition>
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

// ── Ambient Background ──

.launch-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.07;
  animation: orb-drift 20s ease-in-out infinite alternate;
}

.dark .orb {
  opacity: 0.05;
}

.orb-1 {
  width: 500px;
  height: 500px;
  top: -10%;
  left: -5%;
  background: $text-primary;
  animation-duration: 22s;
}

.orb-2 {
  width: 400px;
  height: 400px;
  bottom: -15%;
  right: -8%;
  background: $accent-primary;
  animation-duration: 18s;
  animation-delay: -5s;
}

.orb-3 {
  width: 300px;
  height: 300px;
  top: 40%;
  right: 20%;
  background: $text-secondary;
  animation-duration: 25s;
  animation-delay: -10s;
}

@keyframes orb-drift {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(30px, -20px) scale(1.05); }
  100% { transform: translate(-20px, 30px) scale(0.95); }
}

// ── Content ──

.launch-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 400px;
  max-width: calc(100vw - 32px);
  text-align: center;

  &.redirecting {
    animation: content-exit 0.6s ease forwards;
  }
}

@keyframes content-exit {
  to {
    opacity: 0;
    transform: translateY(-12px);
  }
}

// ── Logo ──

.launch-logo {
  margin-bottom: 24px;
}

.logo-ring {
  position: relative;
  width: 96px;
  height: 96px;
  display: flex;
  align-items: center;
  justify-content: center;

  &::before {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    border: 1.5px solid $border-color;
    animation: ring-pulse 3s ease-in-out infinite;
  }

  &::after {
    content: '';
    position: absolute;
    inset: -12px;
    border-radius: 50%;
    border: 1px solid $border-light;
    opacity: 0.4;
    animation: ring-pulse 3s ease-in-out infinite 1.5s;
  }
}

@keyframes ring-pulse {
  0%, 100% { transform: scale(1); opacity: 0.4; }
  50% { transform: scale(1.06); opacity: 0.8; }
}

.logo-img {
  width: 72px;
  height: 72px;
  border-radius: 16px;
  object-fit: contain;
}

// ── Typography ──

.launch-title {
  font-size: 28px;
  font-weight: 600;
  color: $text-primary;
  margin: 0 0 6px;
  letter-spacing: -0.02em;
}

.launch-subtitle {
  font-size: 13px;
  color: $text-muted;
  margin: 0 0 28px;
  line-height: 1.5;
  min-height: 20px;
  transition: opacity 0.3s ease;
}

// ── Spinner ──

.launch-spinner {
  margin-top: 4px;
}

.spinner-track {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid $border-light;
  position: relative;
}

.spinner-fill {
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: $text-primary;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

// ── Login Form ──

.login-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  margin-top: 4px;
}

.form-fade-enter-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.form-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.login-method-toggle {
  display: flex;
  margin-bottom: 10px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  overflow: hidden;

  .toggle-btn {
    flex: 1;
    padding: 10px;
    border: none;
    background: transparent;
    color: $text-muted;
    font-size: 13px;
    cursor: pointer;
    transition: all $transition-fast;

    &.active {
      background: $text-primary;
      color: var(--text-on-accent);
    }

    &:not(.active):hover {
      background: rgba(var(--accent-primary-rgb), 0.06);
    }
  }
}

.login-input {
  width: 100%;
  padding: 14px 16px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  font-size: 15px;
  color: $text-primary;
  background: $bg-input;
  outline: none;
  transition: border-color $transition-fast;
  box-sizing: border-box;
  font-family: $font-code;

  &::placeholder {
    color: $text-muted;
  }

  &:focus {
    border-color: $accent-primary;
  }
}

.login-error {
  font-size: 13px;
  color: $error;
  text-align: left;
}

.login-btn {
  width: 100%;
  padding: 14px;
  border: none;
  border-radius: $radius-sm;
  background: $text-primary;
  color: var(--text-on-accent);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity $transition-fast;

  &:hover {
    opacity: 0.85;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
</style>
