<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import MessageItem from "./MessageItem.vue";
import { useChatStore } from "@/stores/hermes/chat";
import type { Message } from "@/stores/hermes/chat";

const chatStore = useChatStore();
const { t } = useI18n();
const listRef = ref<HTMLElement>();

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function formatToolDuration(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}m ${secs}s`
}

// 按「一条 user + 本轮全部 tool + 本轮全部 assistant」聚合成单个回答块
type RelatedStep =
  | { id: string; type: "tool"; message: Message; timestamp: number; order: number }
  | { id: string; type: "assistant"; message: Message; timestamp: number; order: number };

const displayMessages = computed(() => {
  const result: Array<{ message: Message; relatedTools: Message[]; relatedSteps: RelatedStep[] }> = [];

  let currentUser: Message | null = null;
  let turnTools: Message[] = [];
  let turnAssistants: Message[] = [];

  const flushTurn = () => {
    if (!currentUser && turnTools.length === 0 && turnAssistants.length === 0) return;

    if (currentUser) {
      result.push({ message: currentUser, relatedTools: [], relatedSteps: [] });
    }

    if (turnTools.length > 0 || turnAssistants.length > 0) {
      const lastAssistant = turnAssistants[turnAssistants.length - 1];
      const mergedContent = turnAssistants
        .map((m) => m.content || "")
        .filter((c) => c.trim() !== "")
        .join("\n\n");
      const mergedReasoning = turnAssistants
        .map((m) => m.reasoning || "")
        .filter((r) => r.trim() !== "")
        .join("\n\n");

      const fallbackTs = turnTools[turnTools.length - 1]?.timestamp ?? Date.now();
      const mergedAssistant: Message = lastAssistant
        ? {
            ...lastAssistant,
            role: "assistant",
            content: lastAssistant.content || mergedContent,
            reasoning: mergedReasoning || undefined,
            isStreaming: turnAssistants.some((m) => !!m.isStreaming),
          }
        : {
            id: `assistant-from-tools-${turnTools[turnTools.length - 1]?.id || Date.now()}`,
            role: "assistant",
            content: "",
            timestamp: fallbackTs,
          };

      const assistantBeforeFinal = turnAssistants.slice(0, Math.max(0, turnAssistants.length - 1));
      const relatedSteps: RelatedStep[] = [
        ...turnTools.map((m, i) => ({
          id: `tool-${m.id}-${i}`,
          type: "tool" as const,
          message: m,
          timestamp: m.timestamp,
          order: i,
        })),
        ...assistantBeforeFinal.map((m, i) => ({
          id: `assistant-${m.id}-${i}`,
          type: "assistant" as const,
          message: m,
          timestamp: m.timestamp,
          order: i,
        })),
      ].sort((a, b) => (a.timestamp === b.timestamp ? a.order - b.order : a.timestamp - b.timestamp));

      result.push({
        message: mergedAssistant,
        relatedTools: [...turnTools],
        relatedSteps,
      });
    }

    currentUser = null;
    turnTools = [];
    turnAssistants = [];
  };

  for (const msg of chatStore.messages) {
    if (msg.role === "user") {
      flushTurn();
      currentUser = msg;
      continue;
    }
    if (msg.role === "tool") {
      turnTools.push(msg);
      continue;
    }
    if (msg.role === "assistant") {
      turnAssistants.push(msg);
      continue;
    }

    // system 等消息独立显示，不参与 turn 聚合
    flushTurn();
    result.push({ message: msg, relatedTools: [], relatedSteps: [] });
  }

  flushTurn();
  return result;
});

const currentToolCalls = computed(() => {
  const msgs = chatStore.messages;
  // Find the last user message index
  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  // Only tool calls after the last user message, newest on top
  const tools = msgs.filter((m, i) => m.role === "tool" && i > lastUserIdx);
  return [...tools].reverse();
});

const expandedToolCallIds = ref<Set<string>>(new Set());

function hasToolCallDetails(tc: {
  toolArgs?: string;
  toolResult?: string;
  toolPreview?: string;
}): boolean {
  return !!(tc.toolArgs || tc.toolResult || tc.toolPreview || tc.toolName);
}

function isToolCallExpanded(id: string): boolean {
  return expandedToolCallIds.value.has(id);
}

function toggleToolCall(id: string) {
  const next = new Set(expandedToolCallIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedToolCallIds.value = next;
}

function toolStatusText(status?: "running" | "done" | "error"): string {
  if (status === "running") return "running";
  if (status === "error") return "error";
  return "done";
}

function toolIconEmoji(name?: string): string {
  const n = (name || "").toLowerCase();
  if (n.includes("search")) return "🔍";
  if (n.includes("fetch") || n.includes("navigate") || n.includes("web")) return "🌐";
  if (n.includes("read") || n.includes("file")) return "📄";
  if (n.includes("bash") || n.includes("shell") || n.includes("run")) return "⚙️";
  if (n.includes("skill")) return "🧩";
  return "🛠";
}

function toolIconTheme(name?: string): string {
  const n = (name || "").toLowerCase();
  if (n.includes("search")) return "icon-search";
  if (n.includes("fetch") || n.includes("navigate") || n.includes("web")) return "icon-web";
  if (n.includes("read") || n.includes("file")) return "icon-file";
  if (n.includes("bash") || n.includes("shell") || n.includes("run")) return "icon-code";
  if (n.includes("skill")) return "icon-skill";
  return "icon-default";
}

function buildToolDetailText(tc: {
  toolName?: string;
  toolStatus?: "running" | "done" | "error";
  toolDuration?: number;
  toolArgs?: string;
  toolResult?: string;
  toolPreview?: string;
  content?: string;
}): string {
  const lines: string[] = [];
  lines.push(`tool: ${tc.toolName || "tool"}`);
  lines.push(`status: ${toolStatusText(tc.toolStatus)}`);
  if (tc.toolDuration && tc.toolStatus !== "running") {
    lines.push(`duration: ${formatToolDuration(tc.toolDuration)}`);
  }
  if (tc.toolPreview) lines.push(`preview: ${tc.toolPreview}`);
  if (tc.toolArgs) lines.push(`args: ${tc.toolArgs}`);
  if (tc.toolResult) lines.push(`result: ${tc.toolResult}`);
  else if (tc.content) lines.push(`content: ${tc.content}`);
  return lines.join("\n");
}

const queuedMessages = computed(() => {
  const sid = chatStore.activeSessionId;
  if (!sid) return [];
  return chatStore.queuedUserMessages.get(sid) || [];
});

function removeQueuedMessage(messageId: string) {
  const sid = chatStore.activeSessionId;
  if (!sid) return;
  chatStore.removeQueuedMessage(sid, messageId);
}

function queuedPreview(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized;
}

function isNearBottom(threshold = 200): boolean {
  const el = listRef.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

function scrollToBottom() {
  nextTick(() => {
    if (listRef.value) {
      listRef.value.scrollTop = listRef.value.scrollHeight;
    }
  });
}

function scrollToMessage(messageId: string) {
  nextTick(() => {
    const el = document.getElementById(`message-${messageId}`);
    if (el) {
      el.scrollIntoView({ block: 'center' });
    }
  });
}

// Scroll to bottom on session switch
watch(
  () => chatStore.activeSessionId,
  (id) => {
    if (!id) return;
    if (chatStore.focusMessageId) {
      nextTick(() => scrollToMessage(chatStore.focusMessageId!));
      return;
    }
    nextTick(() => scrollToBottom());
  },
  { immediate: true },
);

watch(
  () => chatStore.focusMessageId,
  (messageId) => {
    if (!messageId) return;
    scrollToMessage(messageId);
  },
);

// When a run starts (user just sent a message), always scroll to bottom once
watch(
  () => chatStore.isRunActive,
  (v) => {
    if (v) scrollToBottom();
  },
);

// During streaming, only auto-scroll if the user is already near the bottom
watch(
  () => chatStore.messages[chatStore.messages.length - 1]?.content,
  () => {
    if (chatStore.focusMessageId) {
      scrollToMessage(chatStore.focusMessageId);
      return;
    }
    if (!isNearBottom()) return;
    scrollToBottom();
  },
);
watch(currentToolCalls, () => {
  if (chatStore.focusMessageId) {
    scrollToMessage(chatStore.focusMessageId);
    return;
  }
  if (!isNearBottom()) return;
  scrollToBottom();
});
</script>

<template>
  <div ref="listRef" class="message-list">
    <div v-if="chatStore.messages.length === 0" class="empty-state">
      <img src="/logo.png" alt="Hermes" class="empty-logo" />
      <p>{{ t("chat.emptyState") }}</p>
    </div>
    <MessageItem
      v-for="{ message, relatedTools, relatedSteps } in displayMessages"
      :key="message.id"
      :message="message"
      :highlight="chatStore.focusMessageId === message.id"
      :related-tools="relatedTools"
      :related-steps="relatedSteps"
    />
    <Transition name="queue-float">
      <div v-if="queuedMessages.length > 0" class="queue-float-panel">
        <div class="queue-float-header">
          <span class="queue-orbit" aria-hidden="true">
            <span></span>
          </span>
          <span>{{ t('chat.messageQueue') }}</span>
          <strong>{{ queuedMessages.length }}</strong>
        </div>
        <div class="queue-float-list">
          <div
            v-for="(message, index) in queuedMessages"
            :key="message.id"
            class="queue-float-item"
          >
            <span class="queue-index">{{ index + 1 }}</span>
            <span class="queue-text">{{ queuedPreview(message.content) }}</span>
            <button
              type="button"
              class="queue-remove"
              :title="t('chat.removeQueuedMessage')"
              @click="removeQueuedMessage(message.id)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background-color: $bg-card;
  position: relative;

  .dark & {
    background-color: #333333;
  }
}

.queue-float-panel {
  position: sticky;
  right: 16px;
  bottom: 16px;
  z-index: 4;
  align-self: flex-end;
  width: min(340px, calc(100% - 16px));
  margin-top: auto;
  padding: 10px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.22);
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.14);
  backdrop-filter: blur(14px);

  .dark & {
    background: #262626;
  }
}

.queue-float-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px 8px;
  color: $text-secondary;
  font-size: 12px;
  font-weight: 600;

  strong {
    margin-left: auto;
    min-width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: rgba(var(--accent-info-rgb), 0.16);
    color: var(--accent-info);
  }
}

.queue-orbit {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid rgba(var(--accent-info-rgb), 0.28);
  position: relative;
  animation: queue-spin 1.6s linear infinite;

  span {
    position: absolute;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    right: -2px;
    top: 5px;
    background: var(--accent-info);
    box-shadow: 0 0 12px rgba(var(--accent-info-rgb), 0.65);
  }
}

.queue-float-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 172px;
  overflow-y: auto;
}

.queue-float-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 7px 8px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.68);
  color: $text-primary;

  .dark & {
    background: rgba(255, 255, 255, 0.08);
  }
}

.queue-index {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--accent-info);
  background: rgba(var(--accent-info-rgb), 0.12);
}

.queue-text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.queue-remove {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: $text-muted;
  background: transparent;
  cursor: pointer;
  transition: all $transition-fast;

  &:hover {
    color: $error;
    background: rgba($error, 0.1);
  }
}

@media (max-width: 640px) {
  .queue-float-panel {
    right: 8px;
    bottom: 8px;
    width: min(260px, calc(100% - 8px));
    padding: 7px;
    border-radius: 14px;
  }

  .queue-float-header {
    padding: 0 2px;
    font-size: 11px;

    span:nth-child(2) {
      display: none;
    }
  }

  .queue-orbit {
    width: 16px;
    height: 16px;

    span {
      width: 5px;
      height: 5px;
      top: 5px;
    }
  }

  .queue-float-list {
    margin-top: 6px;
    max-height: min(220px, 34dvh);
    overflow-y: auto;
  }

  .queue-float-item {
    min-height: 30px;
    padding: 5px 6px;
  }

  .queue-index {
    width: 18px;
    height: 18px;
    border-radius: 6px;
    font-size: 10px;
  }

  .queue-text {
    font-size: 11px;
  }

  .queue-remove {
    width: 22px;
    height: 22px;
  }
}

@keyframes queue-spin {
  to {
    transform: rotate(360deg);
  }
}

.queue-float-enter-active,
.queue-float-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.queue-float-enter-from,
.queue-float-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: $text-muted;
  gap: 12px;

  .empty-logo {
    width: 48px;
    height: 48px;
    opacity: 0.25;
  }

  p {
    font-size: 14px;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.4s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.streaming-indicator {
  display: flex;
  align-items: flex-start;
  width: 100%;
  padding: 4px;
}

.tool-calls-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(100%, 680px);
  max-height: none;
  overflow: visible;
  padding-top: 4px;
  scrollbar-width: none;
  -ms-overflow-style: none;
  &::-webkit-scrollbar {
    display: none;
  }
}

.tool-call-item {
  --tool-bg: #16181c;
  --tool-bg-2: #1e2026;
  --tool-border: #2a2d35;
  --tool-border-light: #343840;
  --tool-text: #e8eaf0;
  --tool-subtext: #8b8fa8;
  --tool-muted: #555870;

  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--tool-subtext);
  background: #16181c;
  border: 1px solid var(--tool-border);
  border-radius: 10px;
  overflow: hidden;
  transition: border-color 0.2s ease;
  position: relative;
  z-index: 0;
  isolation: isolate;

  .dark & {
    background: #16181c;
  }

  &.compression-item {
    color: $text-muted;
    font-size: 10px;
  }

  &.expandable {
    cursor: pointer;

    &:hover {
      border-color: var(--tool-border-light);
    }
  }
}

.tool-call-header {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 13px;
  min-height: 44px;
}

.tool-call-icon {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;

  &.icon-search {
    background: #1a2744;
    color: #4f8ef7;
  }

  &.icon-web {
    background: #1d2e27;
    color: #3ecf8e;
  }

  &.icon-code {
    background: #27213a;
    color: #a78bfa;
  }

  &.icon-file {
    background: #2e2314;
    color: #f5a623;
  }

  &.icon-skill {
    background: #221d30;
    color: #a78bfa;
  }

  &.icon-default {
    background: #23252b;
    color: #8b8fa8;
  }
}

.tool-call-name {
  font-family: $font-code;
  font-size: 12px;
  font-weight: 500;
  color: var(--tool-text);
  flex: 1;
  min-width: 0;
}

.tool-call-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
  color: var(--tool-subtext);
  font-size: 11px;
}

.tool-call-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: $font-code;
  font-size: 11px;
}

.status-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;

  &.running {
    background: #f5a623;
    animation: tool-status-pulse 1.2s ease-in-out infinite;
  }

  &.done {
    background: #3ecf8e;
  }

  &.error {
    background: #f06292;
  }
}

.status-label {
  color: var(--tool-subtext);
  text-transform: lowercase;
}

.tool-call-chevron {
  color: var(--tool-muted);
  font-size: 10px;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.tool-call-item.open .tool-call-chevron {
  transform: rotate(180deg);
}

.tool-call-body {
  display: block;
  border-top: 1px solid var(--tool-border);
  animation: tool-body-in 0.18s ease;
}

.tool-call-detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 13px 11px;
}

.tool-call-detail + .tool-call-detail {
  border-top: 1px solid var(--tool-border);
}

.tool-call-label {
  font-family: $font-code;
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--tool-muted);
}

.tool-call-code {
  margin: 0;
  padding: 9px 11px;
  border-radius: 7px;
  border: 1px solid var(--tool-border);
  background: var(--tool-bg-2);
  color: var(--tool-subtext);
  font-family: $font-code;
  font-size: 11.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;

  &.running::after {
    content: "▋";
    color: #4f8ef7;
    animation: blink 0.8s step-end infinite;
    margin-left: 2px;
  }
}

.tool-call-progress-bar {
  height: 2px;
  background: var(--tool-border);
  border-radius: 1px;
  overflow: hidden;
}

.tool-call-progress-fill {
  display: block;
  height: 100%;
  width: 35%;
  background: linear-gradient(90deg, #4f8ef7, #a78bfa);
  animation: tool-progress 1.6s ease-in-out infinite;
}

.tool-call-spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid $text-muted;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

.tool-call-error-icon {
  color: #ff4d4f;
  flex-shrink: 0;
  margin-left: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tool-call-duration {
  font-size: 10.5px;
  color: var(--tool-muted);
  font-family: $font-code;
  margin-left: 2px;
  flex-shrink: 0;
}

.tool-call-success-icon {
  color: #52c41a;
  flex-shrink: 0;
  margin-left: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

@keyframes tool-progress {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(340%);
  }
}

@keyframes tool-status-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.75);
  }
}

@keyframes tool-body-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
