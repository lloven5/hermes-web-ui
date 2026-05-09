<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { setApiKey, hasApiKey } from "@/api/client";
import { fetchAuthStatus, loginWithPassword } from "@/api/auth";
import { setAuthDisabled, setAuthChecked } from "@/router";

const { t } = useI18n();
const router = useRouter();

const phase = ref<"login" | "redirecting">("login");
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
      setTimeout(() => router.replace("/hermes/chat"), 100);
      return;
    }
    setAuthDisabled(false);
    if (hasApiKey()) {
      setAuthChecked(true);
      setTimeout(() => router.replace("/hermes/chat"), 100);
      return;
    }
    hasPasswordLogin.value = status.hasPasswordLogin;
    if (status.hasPasswordLogin && !urlToken) {
      loginMethod.value = "password";
    }
    setAuthChecked(true);
  } catch {
    setAuthDisabled(true);
    setAuthChecked(true);
    setTimeout(() => router.replace("/hermes/chat"), 100);
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
  <div class="login-view">
    <div class="login-content">
      <h1 class="login-title">{{ t('login.title') }}</h1>
      <p class="login-description">{{ t('login.description') }}</p>

      <form class="login-form" @submit.prevent="handleLogin">
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
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.login-view {
  position: relative;
  height: calc(100 * var(--vh));
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: $bg-primary;
}

.login-content {
  display: flex;
  flex-direction: column;
  width: 320px;
  max-width: calc(100vw - 32px);
  text-align: center;
}

.login-title {
  font-size: 24px;
  font-weight: 600;
  color: $text-primary;
  margin: 0 0 8px;
}

.login-description {
  font-size: 13px;
  color: $text-muted;
  margin: 0 0 20px;
  line-height: 1.5;
}

// ── Login Form ──

.login-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
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
