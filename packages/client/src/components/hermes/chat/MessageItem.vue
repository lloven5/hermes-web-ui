<script setup lang="ts">
import type { Message, ContentBlock } from "@/stores/hermes/chat";
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { useMessage } from "naive-ui";
import { downloadFile } from "@/api/hermes/download";
	import { getApiKey } from "@/api/client";
import { copyToClipboard } from "@/utils/clipboard";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import { parseThinking, countThinkingChars } from "@/utils/thinking-parser";
import { useChatStore } from "@/stores/hermes/chat";
import { useSettingsStore } from "@/stores/hermes/settings";
import {
  copyTextToClipboard,
  handleCodeBlockCopyClick,
  renderHighlightedCodeBlock,
} from "./highlight";
import { useGlobalSpeech } from "@/composables/useSpeech";
import { formatToolDuration } from "@/utils/duration";

const TOOL_PAYLOAD_DISPLAY_LIMIT = 2000;

/**
 * 将 JSON 字符串转美化后的 HTML 展示（带语法高亮 class）
 * 例：{"query": "hello", "count": 3}
 * → <span class="param-key">"query"</span>: <span class="param-str">"hello"</span>
 *   <span class="param-key">"count"</span>: <span class="param-num">3</span>
 */
function jsonToPrettyHtml(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    if (typeof obj !== 'object' || obj === null) return '';
    const entries = Object.entries(obj);
    if (entries.length === 0) return '';
    return entries.map(([key, value]) => {
      const keyHtml = `<span class="param-key">"${escapeHtml(key)}"</span>`;
      const valHtml = formatJsonValueHtml(value);
      return `${keyHtml}: ${valHtml}`;
    }).join('\n');
  } catch {
    // 非 JSON 文本，直接展示，但做 HTML 转义
    return escapeHtml(raw);
  }
}

/** 递归格式化 JSON 值 → HTML（完全展示，不截断） */
function formatJsonValueHtml(val: unknown): string {
  if (val === null) return `<span class="param-keyword">null</span>`;
  if (typeof val === 'string') {
    return `<span class="param-str">"${escapeHtml(val)}"</span>`;
  }
  if (typeof val === 'number') {
    return `<span class="param-num">${val}</span>`;
  }
  if (typeof val === 'boolean') {
    return `<span class="param-keyword">${val}</span>`;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return `<span class="param-keyword">[]</span>`;
    const items = val.map(v => formatJsonValueHtml(v));
    return `[${items.join(', ')}]`;
  }
  if (typeof val === 'object') {
    const subEntries = Object.entries(val as Record<string, unknown>);
    if (subEntries.length === 0) return `<span class="param-keyword">{}</span>`;
    const sub = subEntries.map(([k, v]) => {
      return `<span class="param-key">"${escapeHtml(k)}"</span>: ${formatJsonValueHtml(v)}`;
    });
    return `{ ${sub.join(', ')} }`;
  }
  return escapeHtml(String(val));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

type RelatedStep = {
  id: string;
  type: "tool" | "assistant";
  message: Message;
  timestamp: number;
  order: number;
};

const props = defineProps<{ message: Message; highlight?: boolean; relatedTools?: Message[]; relatedSteps?: RelatedStep[] }>();
const { t } = useI18n();
const toast = useMessage();

const isSystem = computed(() => props.message.role === "system");

// 工具调用相关
const expandedToolIds = ref<Set<string>>(new Set());

const relatedToolCalls = computed(() => {
  // 从 props 获取关联的工具调用，或通过消息索引关联
  return props.relatedTools || [];
});

const relatedSteps = computed(() => props.relatedSteps || []);

const hasRunningTools = computed(() => {
  return relatedToolCalls.value.some(tc => tc.toolStatus === "running");
});

function isToolExpanded(id: string): boolean {
  // 默认展开，用户点击后可折叠
  // expandedToolIds 存储的是用户主动折叠过的工具 ID
  return !expandedToolIds.value.has(id);
}

function toggleTool(id: string) {
  const next = new Set(expandedToolIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedToolIds.value = next;
}

function toolIconEmoji(name?: string): string {
  const n = (name || "").toLowerCase();
  if (n.includes("search")) return "🔍";
  if (n.includes("fetch") || n.includes("navigate") || n.includes("web")) return "🌐";
  if (n.includes("read")) return "📄";
  if (n.includes("terminal") || n.includes("bash") || n.includes("shell") || n.includes("run") || n.includes("code")) return "⚙️";
  if (n.includes("skill")) return "🧩";
  return "🛠";
}

function toolIconTheme(name?: string): string {
  const n = (name || "").toLowerCase();
  if (n.includes("search")) return "icon-search";
  if (n.includes("fetch") || n.includes("navigate") || n.includes("web")) return "icon-web";
  if (n.includes("read")) return "icon-file";
  if (n.includes("terminal") || n.includes("bash") || n.includes("shell") || n.includes("run") || n.includes("code")) return "icon-code";
  if (n.includes("skill")) return "icon-skill";
  return "icon-default";
}

function toolStatusText(status?: "running" | "done" | "error"): string {
  if (status === "running") return "running";
  if (status === "error") return "error";
  return "done";
}

function toolStatusClass(status?: "running" | "done" | "error"): string {
  if (status === "running") return "running";
  if (status === "error") return "error";
  return "done";
}

function isLikelyUrl(value?: string): boolean {
  if (!value) return false;
  return /^https?:\/\//i.test(value.trim());
}

function deriveToolInput(tc: Message): string {
  if (tc.toolArgs && tc.toolArgs.trim()) {
    // 使用美化后的纯文本展示
    return formatToolPayload(tc.toolArgs).plain;
  }

  const name = (tc.toolName || "").toLowerCase();
  if ((name.includes("navigate") || name.includes("fetch") || name.includes("search")) && isLikelyUrl(tc.toolPreview)) {
    return tc.toolPreview!;
  }

  if (tc.toolPreview && tc.toolPreview.trim()) return tc.toolPreview;
  // 流式进行中但尚无 toolArgs 时显示友好占位
  if (tc.toolStatus === 'running') return '等待输入参数...';
  // 流式已完成但 DB 补全尚未完成时显示
  if (tc.toolStatus === 'done' || tc.toolStatus === 'error') return '';
  return tc.toolName || "No input payload";
}

function deriveToolOutput(tc: Message): string {
  if (tc.toolResult && tc.toolResult.trim()) {
    // 使用美化后的纯文本展示
    return formatToolPayload(tc.toolResult).plain;
  }
  // 仅在运行中回退到 preview（通常是中间进度文案）
  if (tc.toolStatus === "running" && tc.toolPreview && tc.toolPreview.trim()) return tc.toolPreview;
  if (tc.toolStatus === "error") return "";
  if (tc.toolStatus === "done") return "";
  if (tc.toolStatus === "running") return "等待执行结果...";
  return "";
}

function isSkillStep(name?: string): boolean {
  return (name || "").toLowerCase().includes("skill");
}

function renderedStepInput(tc: Message): string {
  if (tc.toolArgs && tc.toolArgs.trim()) {
    const html = jsonToPrettyHtml(tc.toolArgs);
    if (html) return html;
  }
  const text = deriveToolInput(tc);
  return text ? escapeHtml(text) : '';
}

function renderedStepOutput(tc: Message): string {
  if (tc.toolResult && tc.toolResult.trim()) {
    try {
      const parsed = JSON.parse(tc.toolResult);
      if (typeof parsed === 'object' && parsed !== null) {
        return jsonToPrettyHtml(tc.toolResult);
      }
    } catch { /* not JSON */ }
    const raw = tc.toolResult;
    return escapeHtml(raw.length > 4000 ? raw.slice(0, 4000) + '…' : raw);
  }
  if (tc.toolStatus === 'running') {
    return escapeHtml(tc.toolPreview || '等待执行结果...');
  }
  return '';
}

// Parse ContentBlock[] from JSON string
const contentBlocks = computed(() => {
  const content = props.message.content || '';
  if (!content.trim()) return null;

  try {
    // Try to parse as ContentBlock[] array
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0 && 'type' in parsed[0]) {
      return parsed as ContentBlock[];
    }
  } catch {
    // Not valid JSON, treat as plain text
  }

  return null;
});

// Check if content is in ContentBlock[] format
const isContentBlockArray = computed(() => contentBlocks.value !== null);

// Extract text content from ContentBlock[] for display
const displayText = computed(() => {
  if (!isContentBlockArray.value) {
    return props.message.content || '';
  }

  // Extract text from blocks
  return contentBlocks.value!
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
});

// Extract files from ContentBlock[]
const contentFiles = computed(() => {
  if (!isContentBlockArray.value) return null;

  return contentBlocks.value!.filter(block => block.type === 'image' || block.type === 'file');
});

// Generate download URL with auth token
function getDownloadUrl(path: string, name: string): string {
	const token = getApiKey();
	const base = `/api/hermes/download?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`;
	return token ? `${base}&token=${encodeURIComponent(token)}` : base;
}

const toolExpanded = ref(false);
const previewUrl = ref<string | null>(null);

const chatStore = useChatStore();
const settingsStore = useSettingsStore();
const speech = useGlobalSpeech();

// Copy entire bubble content
const copyableContent = computed(() => {
  if (props.message.role === 'tool') return null
  const content = props.message.content || ''
  if (!content.trim()) return null
  return content
})

async function copyBubbleContent() {
  const text = copyableContent.value
  if (!text) return
  const ok = await copyToClipboard(text)
  if (ok) {
    toast.success(t('chat.copiedBubble'))
    return
  }
  toast.error(t('chat.copyFailed'))
}

const parsedThinking = computed(() =>
  parseThinking(props.message.content || "", { streaming: !!props.message.isStreaming }),
);

// 优先使用来自 reasoning 字段/事件的思考文本；否则回退到从 content 解析的 <think> 标签。
// 若两者共存，则拼接展示（罕见，但保持信息不丢）。
const hasReasoningField = computed(() => !!(props.message.reasoning && props.message.reasoning.length > 0));

const hasThinking = computed(() => hasReasoningField.value || parsedThinking.value.hasThinking);

const thinkingFullText = computed(() => {
  const parts: string[] = [];
  if (props.message.reasoning) parts.push(props.message.reasoning);
  parts.push(...parsedThinking.value.segments);
  if (parsedThinking.value.pending) parts.push(parsedThinking.value.pending);
  return parts.join("\n\n");
});

const thinkingCharCount = computed(() => {
  let count = countThinkingChars(parsedThinking.value);
  if (props.message.reasoning) count += props.message.reasoning.length;
  return count;
});

// 流式思考态：仍有未闭合 <think> 标签，或 reasoning 有内容但正文尚未开始。
const thinkingStreamingNow = computed(() => {
  if (!props.message.isStreaming) return false;
  if (parsedThinking.value.pending !== null) return true;
  if (hasReasoningField.value && !props.message.content) return true;
  return false;
});

const thinkingOverride = ref<boolean | null>(null);

const thinkingExpanded = computed(() => {
  if (thinkingStreamingNow.value) return true;
  if (thinkingOverride.value !== null) return thinkingOverride.value;
  return !!settingsStore.display.show_reasoning;
});

function toggleThinking() {
  thinkingOverride.value = !thinkingExpanded.value;
}

const nowTick = ref(Date.now());
let tickTimer: number | null = null;

function ensureTick() {
  const ob = chatStore.getThinkingObservation(props.message.id);
  const shouldTick = !!(
    props.message.isStreaming &&
    ob?.startedAt !== undefined &&
    ob.endedAt === undefined
  );
  if (shouldTick && tickTimer === null) {
    tickTimer = window.setInterval(() => {
      nowTick.value = Date.now();
    }, 1000);
  } else if (!shouldTick && tickTimer !== null) {
    window.clearInterval(tickTimer);
    tickTimer = null;
  }
}

watchEffect(ensureTick);

onBeforeUnmount(() => {
  if (tickTimer !== null) window.clearInterval(tickTimer);
});

const thinkingDurationMs = computed<number | null>(() => {
  const ob = chatStore.getThinkingObservation(props.message.id);
  if (!ob?.startedAt) return null;
  const startedAt = ob.startedAt!; // Non-null assertion after check
  const end = ob?.endedAt ?? (props.message.isStreaming ? nowTick.value : startedAt);
  return Math.max(0, end - startedAt);
});

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m ${r}s`;
}

const timeStr = computed(() => {
  const d = new Date(props.message.timestamp);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
});

function isImage(type: string): boolean {
  return type.startsWith("image/");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/**
 * Extract the upload file path from message content for a given attachment.
 * Upload format in content: [File: name.txt](/tmp/hermes-uploads/abc123.txt)
 */
function getFilePathFromContent(attName: string): string | null {
  const content = props.message.content || "";

  // Try ContentBlock[] format first
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0 && 'type' in parsed[0]) {
      const fileBlock = parsed.find((block: any) =>
        block.type === 'file' && block.name === attName
      );
      if (fileBlock && (fileBlock as any).path) {
        return (fileBlock as any).path;
      }
    }
  } catch {
    // Not valid JSON, continue to regex matching
  }

  // Fallback to markdown format: [File: name](path)
  const regex = /\[File:\s*([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match[1].trim() === attName.trim()) return match[2];
  }

  return null;
}

function handleAttachmentDownload(att: { name: string; url: string; type: string }) {
  const filePath = getFilePathFromContent(att.name);
  if (filePath) {
    toast.info(t("download.downloading"));
    downloadFile(filePath, att.name).catch((err: Error) => {
      toast.error(err.message || t("download.downloadFailed"));
    });
    return;
  }
  if (att.url && att.url.startsWith("blob:")) {
    const a = document.createElement("a");
    a.href = att.url;
    a.download = att.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

type ToolPayload = {
  full: string;
  display: string;        // 美化后的 HTML（用于 v-html）
  plain: string;          // 纯文本预览（用于新版气泡）
  language?: string;
};

/**
 * 将工具参数/结果的原始数据格式化为友好展示
 * - JSON 对象 → 带语法高亮的键值对 HTML（用于旧版 tool-line）
 * - JSON 对象 → 简洁纯文本（用于新版 tool-bubble）
 * - 非 JSON → 原样返回
 */
function formatToolPayload(raw?: string): ToolPayload {
  if (!raw) {
    return { full: "", display: "", plain: "" };
  }

  // 尝试解析 JSON
  try {
    const parsed = JSON.parse(raw);
    const full = JSON.stringify(parsed, null, 2);

    // 生成美化 HTML（用于旧版 tool-line 的 v-html）
    const displayHtml = jsonToPrettyHtml(raw);

    // 生成纯文本预览（用于新版 tool-bubble 的 pre 文本）
    const plain = jsonToPrettyPlain(parsed);

    return {
      full,
      display: displayHtml,
      plain,
    };
  } catch {
    // 不是 JSON，原样展示（不截断）
    return {
      full: raw,
      display: escapeHtml(raw),
      plain: raw,
    };
  }
}

/**
 * 将 JSON 值转为纯文本展示（完全展示，不截断）
 */
function jsonToPrettyPlain(val: unknown, maxDepth = 5): string {
  if (val === null) return 'null';
  if (typeof val === 'string') {
    return `"${val}"`;
  }
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    if (maxDepth <= 0) return '[…]';
    const items = val.map(v => jsonToPrettyPlain(v, maxDepth - 1));
    return `[${items.join(', ')}]`;
  }
  if (typeof val === 'object') {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    if (maxDepth <= 0) return '{…}';
    const parts = entries.map(([k, v]) => `${k}=${jsonToPrettyPlain(v, maxDepth - 1)}`);
    return `{ ${parts.join(', ')} }`;
  }
  return String(val);
}

function renderToolPayload(content: string, language?: string): string {
  return renderHighlightedCodeBlock(content, language, t("common.copy"), {
    maxHighlightLength: TOOL_PAYLOAD_DISPLAY_LIMIT,
  });
}

async function handleToolDetailClick(event: MouseEvent): Promise<void> {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const button = target.closest<HTMLElement>("[data-copy-code=\"true\"]");
  if (!button) return;

  event.preventDefault();

  const source = button.closest<HTMLElement>("[data-copy-source]")?.dataset.copySource;
  if (source === "tool-args" && fullToolArgs.value) {
    const ok = await copyTextToClipboard(fullToolArgs.value);
    if (ok) toast.success(t("common.copied"));
    else toast.error(t("chat.copyFailed"));
    return;
  }
  if (source === "tool-result" && fullToolResult.value) {
    const ok = await copyTextToClipboard(fullToolResult.value);
    if (ok) toast.success(t("common.copied"));
    else toast.error(t("chat.copyFailed"));
    return;
  }

  const copyResult = await handleCodeBlockCopyClick(event);
  if (copyResult) toast.success(t("common.copied"));
  else if (copyResult === false) toast.error(t("chat.copyFailed"));
}

const hasAttachments = computed(
  () => (props.message.attachments?.length ?? 0) > 0,
);

const hasVisibleMessageContent = computed(() => {
  if (props.message.role === "assistant") {
    return !!(parsedThinking.body?.trim() || props.message.content?.trim());
  }
  if (props.message.role === "user") {
    return !!(displayText.value?.trim() || props.message.content?.trim());
  }
  return !!props.message.content?.trim();
});

const hasInlineContentAttachments = computed(
  () => (contentFiles.value?.length ?? 0) > 0,
);

const shouldRenderNonToolMessage = computed(() => {
  if (props.message.role === "tool") return true;
  return (
    hasVisibleMessageContent.value ||
    hasAttachments.value ||
    hasInlineContentAttachments.value ||
    hasThinking.value ||
    !!props.message.isStreaming
  );
});

const hasToolDetails = computed(
  () => !!(props.message.toolArgs || props.message.toolResult),
);

const toolStatusLabel = computed(() => {
  if (props.message.toolStatus === "running") return "running";
  if (props.message.toolStatus === "error") return "error";
  return "done";
});

const isSkillTool = computed(() => {
  const name = (props.message.toolName || "").toLowerCase();
  return name.includes("skill");
});

const toolIcon = computed(() => {
  const name = (props.message.toolName || "").toLowerCase();
  if (name.includes("search")) return "🔍";
  if (name.includes("fetch") || name.includes("web")) return "🌐";
  if (name.includes("read")) return "📄";
  if (name.includes("bash") || name.includes("shell") || name.includes("run")) return "⚙️";
  if (name.includes("skill")) return "🧩";
  return "🛠️";
});

const toolIconClass = computed(() => {
  const name = (props.message.toolName || "").toLowerCase();
  if (name.includes("search")) return "icon-search";
  if (name.includes("fetch") || name.includes("web")) return "icon-web";
  if (name.includes("read")) return "icon-file";
  if (name.includes("bash") || name.includes("shell") || name.includes("run")) return "icon-code";
  if (name.includes("skill")) return "icon-skill";
  return "icon-default";
});

const toolArgsPayload = computed(() => formatToolPayload(props.message.toolArgs));
const toolResultPayload = computed(() => formatToolPayload(props.message.toolResult));

const fullToolArgs = computed(() => toolArgsPayload.value.full);
const formattedToolArgs = computed(() => toolArgsPayload.value.display);
const fullToolResult = computed(() => toolResultPayload.value.full);
const formattedToolResult = computed(() => toolResultPayload.value.display);

const toolArgsPlain = computed(() => toolArgsPayload.value.plain);
const toolResultPlain = computed(() => toolResultPayload.value.plain);

// 旧版 tool-line：美化后的 HTML key-value（跳过 highlight，直接 v-html）
const renderedToolArgs = computed(() => {
  if (!formattedToolArgs.value) return "";
  // display 已经是 jsonToPrettyHtml 生成的美化 HTML
  return `<div class="pretty-param-block">${formattedToolArgs.value}</div>`;
});

const renderedToolResult = computed(() => {
  if (!formattedToolResult.value) return "";
  return `<div class="pretty-param-block">${formattedToolResult.value}</div>`;
});

// 语音播放相关
const canPlaySpeech = computed(() => {
  // 只有 assistant 消息可以播放，且浏览器支持 Web Speech API
  return props.message.role === 'assistant' &&
         speech.isSupported &&
         copyableContent.value;
});

const isPlayingThisMessage = computed(() => {
  return speech.currentMessageId.value === props.message.id && speech.isPlaying.value;
});

const isPausedThisMessage = computed(() => {
  return speech.currentMessageId.value === props.message.id && speech.isPaused.value;
});

function handleSpeechToggle() {
  if (!canPlaySpeech.value) {
    return
  }
  const content = props.message.content || ''
  speech.toggle(props.message.id, content, getSpeechOptions())
}

function getSpeechOptions() {
  // 尝试获取男声语音包
  const allVoices = speech.getAllVoices()
  let maleVoice: SpeechSynthesisVoice | null = null

  // 查找可能的男声语音包
  for (const voice of allVoices) {
    const name = voice.name.toLowerCase()
    // 常见男声关键词
    if (name.includes('male') || name.includes('david') || name.includes('daniel') ||
        name.includes('mark') || name.includes('yaoyao') || name.includes('google')) {
      // 优先选择中文男声
      if (voice.lang.startsWith('zh')) {
        maleVoice = voice
        break
      }
      // 如果没有找到中文男声，记住第一个男声
      if (!maleVoice) {
        maleVoice = voice
      }
    }
  }

  // 快速男声：语速快、音调低
  return {
    pitch: 0.5,   // 低沉
    rate: 1.2,    // 快速
    voice: maleVoice || undefined, // 使用男声，如果没有就用默认
  }
}

// 监听自动播放事件
let autoPlayHandler: ((e: Event) => void) | null = null

onMounted(() => {
  autoPlayHandler = (e: Event) => {
    const customEvent = e as CustomEvent<{ messageId: string; content: string }>
    if (customEvent.detail.messageId === props.message.id && canPlaySpeech.value) {
      speech.enqueue(props.message.id, customEvent.detail.content || props.message.content || '', getSpeechOptions())
    }
  }
  window.addEventListener('auto-play-speech', autoPlayHandler)
})

// 组件卸载时停止播放并清理事件监听
onBeforeUnmount(() => {
  if (autoPlayHandler) {
    window.removeEventListener('auto-play-speech', autoPlayHandler)
  }
  if (speech.currentMessageId.value === props.message.id) {
    speech.stop();
  }
});
</script>

<template>
  <div
    v-if="message.role === 'tool' || shouldRenderNonToolMessage"
    class="message"
    :class="[message.role, { highlight }]"
    :id="`message-${message.id}`"
  >
    <template v-if="message.role === 'tool'">
      <div
        class="tool-line"
        :class="[{ expandable: hasToolDetails || message.toolStatus === 'running' }, { 'skill-tool': isSkillTool }]"
        @click="hasToolDetails && (toolExpanded = !toolExpanded)"
      >
        <span class="tool-icon-badge" :class="toolIconClass">{{ toolIcon }}</span>
        <span class="tool-name">{{ message.toolName }}</span>
        <span class="tool-status-inline">
          <span class="status-dot" :class="toolStatusLabel"></span>
          <span class="status-label">{{ toolStatusLabel }}</span>
        </span>
        <span v-if="message.toolPreview && !toolExpanded" class="tool-preview">{{ message.toolPreview }}</span>
        <span v-if="hasToolDetails || message.toolStatus === 'running'" class="tool-chevron" :class="{ rotated: toolExpanded }">▾</span>
      </div>
      <div v-if="toolExpanded && (hasToolDetails || message.toolStatus === 'running')" class="tool-details" @click="handleToolDetailClick">
        <div v-if="message.toolStatus === 'running'" class="tool-detail-section">
          <div class="tool-progress-bar"><span class="tool-progress-fill"></span></div>
          <div class="tool-streaming-text">{{ message.toolPreview || "Running..." }}</div>
        </div>
        <div v-if="formattedToolArgs" class="tool-detail-section" data-copy-source="tool-args">
          <div class="tool-detail-label">{{ t("chat.arguments") }}</div>
          <div class="tool-detail-code-block" v-html="renderedToolArgs"></div>
        </div>
        <div v-if="formattedToolResult" class="tool-detail-section" data-copy-source="tool-result">
          <div class="tool-detail-label">{{ t("chat.result") }}</div>
          <div class="tool-detail-code-block" :class="{ 'result-error': message.toolStatus === 'error', 'result-success': message.toolStatus !== 'error' }" v-html="renderedToolResult"></div>
        </div>
      </div>
    </template>
    <template v-else-if="message.role === 'assistant'">
      <!-- 新的 assistant 结构：工具卡片 + 回复框 -->
      <div class="assistant-row">
        <div class="assistant-avatar">✦</div>
        <div class="assistant-content">
          <!-- 过程小框：按真实顺序展示工具 + 中间说明 -->
          <div v-if="relatedSteps.length > 0" class="process-box">
            <div class="process-title">Process</div>
            <div class="process-list">
              <template v-for="step in relatedSteps" :key="step.id">
                <div v-if="step.type === 'assistant'" class="process-note">
                  {{ step.message.content }}
                </div>
                <!-- Skill bubble -->
                <div
                  v-else-if="isSkillStep(step.message.toolName)"
                  class="skill-bubble"
                  :class="{ open: isToolExpanded(step.message.id) }"
                >
                  <div class="skill-header" @click="toggleTool(step.message.id)">
                    <span class="skill-tag">SKILL</span>
                    <span class="skill-name">{{ step.message.toolName }}</span>
                    <div class="tool-status">
                      <span class="status-dot" :class="toolStatusClass(step.message.toolStatus)"></span>
                      <span class="status-label">{{ toolStatusText(step.message.toolStatus) }}</span>
                      <span v-if="step.message.toolDuration && step.message.toolStatus !== 'running'" class="duration">{{ formatDuration(step.message.toolDuration) }}</span>
                    </div>
                    <span class="chevron">▾</span>
                  </div>
                  <div class="tool-divider"></div>
                  <div class="skill-body">
                    <div class="skill-body-inner">
                      <div class="skill-content" v-html="renderedStepOutput(step.message)"></div>
                    </div>
                  </div>
                </div>
                <!-- Regular tool bubble -->
                <div
                  v-else
                  class="tool-bubble"
                  :class="[toolIconTheme(step.message.toolName), { open: isToolExpanded(step.message.id) }]"
                >
                  <div class="tool-header" @click="toggleTool(step.message.id)">
                    <span class="tool-icon" :class="toolIconTheme(step.message.toolName)">{{ toolIconEmoji(step.message.toolName) }}</span>
                    <span class="tool-name">{{ step.message.toolName }}</span>
                    <div class="tool-status">
                      <span class="status-dot" :class="toolStatusClass(step.message.toolStatus)"></span>
                      <span class="status-label">{{ toolStatusText(step.message.toolStatus) }}</span>
                      <span v-if="step.message.toolDuration && step.message.toolStatus !== 'running'" class="duration">{{ formatDuration(step.message.toolDuration) }}</span>
                    </div>
                    <span class="chevron">▾</span>
                  </div>
                  <div class="tool-divider"></div>
                  <div class="tool-body">
                    <div class="tool-body-inner">
                      <div class="tool-section">
                        <div class="section-label">Input</div>
                        <div class="param-block" v-html="renderedStepInput(step.message)"></div>
                      </div>
                      <div class="tool-section">
                        <div class="section-label">Output</div>
                        <div v-if="step.message.toolStatus === 'running'" class="progress-bar">
                          <span class="progress-fill"></span>
                        </div>
                        <div class="result-block" :class="{ 'stream-text': step.message.toolStatus === 'running', 'success': step.message.toolStatus === 'done', 'error-r': step.message.toolStatus === 'error' }" v-html="renderedStepOutput(step.message)"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- 回复内容框 -->
          <div class="reply-block">
            <div v-if="hasAttachments" class="msg-attachments">
              <div
                v-for="att in message.attachments"
                :key="att.id"
                class="msg-attachment"
                :class="{ image: isImage(att.type) }"
              >
                <template v-if="isImage(att.type) && att.url">
                  <img
                    :src="att.url"
                    :alt="att.name"
                    class="msg-attachment-thumb"
                    @click="previewUrl = att.url"
                  />
                </template>
                <template v-else>
                  <div class="msg-attachment-file" @click="handleAttachmentDownload(att)" style="cursor: pointer;" :title="t('download.downloadFile')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span class="att-name">{{ att.name }}</span>
                    <span class="att-size">{{ formatSize(att.size) }}</span>
                  </div>
                </template>
              </div>
            </div>
            <div
              v-if="hasThinking"
              class="thinking-block"
              :class="{ expanded: thinkingExpanded }"
            >
              <div class="thinking-header" @click="toggleThinking">
                <span class="thinking-icon">💭</span>
                <span class="thinking-label">{{ thinkingStreamingNow ? t('chat.thinkingInProgress') : t('chat.thinkingLabel') }}</span>
                <span v-if="thinkingDurationMs !== null && thinkingDurationMs > 0" class="thinking-meta">· {{ formatDuration(thinkingDurationMs) }}</span>
                <span class="thinking-meta">· {{ thinkingCharCount }}</span>
              </div>
              <div v-if="thinkingExpanded" class="thinking-body">
                <MarkdownRenderer :content="thinkingFullText" />
              </div>
            </div>
            <MarkdownRenderer
              v-if="parsedThinking.body"
              :content="parsedThinking.body"
            />
            <MarkdownRenderer
              v-else-if="message.content"
              :content="message.content"
            />
            <span v-if="message.isStreaming && !message.content && !hasRunningTools" class="streaming-dots">
              <span></span><span></span><span></span>
            </span>
          </div>

          <!-- 操作栏 -->
          <div class="action-bar">
            <button
              v-if="canPlaySpeech"
              class="action-btn"
              :class="{ playing: isPlayingThisMessage, paused: isPausedThisMessage }"
              @click="handleSpeechToggle"
            >
              <svg v-if="!isPlayingThisMessage || isPausedThisMessage" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="6" y="4" width="4" height="16"/>
                <rect x="14" y="4" width="4" height="16"/>
              </svg>
            </button>
            <button
              v-if="copyableContent"
              class="action-btn"
              @click="copyBubbleContent"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
            <span class="message-time">{{ timeStr }}</span>
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="msg-body">
        <div class="msg-content" :class="message.role">
          <div class="message-bubble" :class="{ system: isSystem, 'speech-playing': isPlayingThisMessage && !isPausedThisMessage }">
            <div v-if="hasAttachments" class="msg-attachments">
              <div
                v-for="att in message.attachments"
                :key="att.id"
                class="msg-attachment"
                :class="{ image: isImage(att.type) }"
              >
                <template v-if="isImage(att.type) && att.url">
                  <img
                    :src="att.url"
                    :alt="att.name"
                    class="msg-attachment-thumb"
                    @click="previewUrl = att.url"
                  />
                </template>
                <template v-else>
                  <div class="msg-attachment-file" @click="handleAttachmentDownload(att)" style="cursor: pointer;" :title="t('download.downloadFile')">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                    >
                      <path
                        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                      />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span class="att-name">{{ att.name }}</span>
                    <span class="att-size">{{ formatSize(att.size) }}</span>
                    <svg class="att-download-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </div>
                </template>
              </div>
            </div>
            <div
              v-if="hasThinking"
              class="thinking-block"
              :class="{ expanded: thinkingExpanded }"
            >
              <div class="thinking-header" @click="toggleThinking">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  class="thinking-chevron"
                  :class="{ rotated: thinkingExpanded }"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span class="thinking-icon">💭</span>
                <span class="thinking-label">
                  {{
                    thinkingStreamingNow
                      ? t('chat.thinkingInProgress')
                      : t('chat.thinkingLabel')
                  }}
                </span>
                <span v-if="thinkingDurationMs !== null && thinkingDurationMs > 0" class="thinking-meta">
                  · {{ t('chat.thinkingDuration', { duration: formatDuration(thinkingDurationMs) }) }}
                </span>
                <span class="thinking-meta">
                  · {{ t('chat.thinkingChars', { count: thinkingCharCount }) }}
                </span>
              </div>
              <div v-if="thinkingExpanded" class="thinking-body">
                <MarkdownRenderer :content="thinkingFullText" />
              </div>
            </div>
            <MarkdownRenderer
              v-if="parsedThinking.body && message.role === 'assistant'"
              :content="parsedThinking.body"
            />

            <!-- Render user message content -->
            <template v-if="message.role === 'user'">
              <!-- ContentBlock[] format -->
              <template v-if="isContentBlockArray">
                <div v-if="contentFiles && contentFiles.length > 0" class="msg-attachments">
                  <div
                    v-for="(file, idx) in contentFiles"
                    :key="idx"
                    class="msg-attachment"
                    :class="{ image: file.type === 'image' }"
                  >
                    <template v-if="file.type === 'image'">
                      <img
                        :src="getDownloadUrl(file.path, file.name)"
                        :alt="file.name"
                        class="msg-attachment-thumb"
                        @click="previewUrl = getDownloadUrl(file.path, file.name)"
                      />
                    </template>
                    <template v-else>
                      <div
                        class="msg-attachment-file"
                        @click="downloadFile(file.path, file.name).catch(err => toast.error(err.message || t('download.downloadFailed')))"
                        style="cursor: pointer;"
                        :title="t('download.downloadFile')"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <span class="att-name">{{ file.name }}</span>
                      </div>
                    </template>
                  </div>
                </div>
                <MarkdownRenderer v-if="displayText" :content="displayText" />
              </template>
              <!-- Plain text format -->
              <MarkdownRenderer v-else-if="message.content" :content="message.content" />
            </template>

            <!-- Render assistant message content -->
            <MarkdownRenderer
              v-if="message.role === 'assistant' && message.content && !parsedThinking.body"
              :content="message.content"
            />

            <span v-if="message.isStreaming && !message.content" class="streaming-dots">
              <span></span><span></span><span></span>
            </span>
          </div>
          <div class="message-meta">
            <button
              v-if="canPlaySpeech"
              class="speech-bubble-btn"
              :class="{ playing: isPlayingThisMessage, paused: isPausedThisMessage }"
              @click="handleSpeechToggle"
              :title="isPlayingThisMessage ? (isPausedThisMessage ? t('chat.resumeSpeech') : t('chat.pauseSpeech')) : t('chat.playSpeech')"
            >
              <svg v-if="!isPlayingThisMessage || isPausedThisMessage" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="6" y="4" width="4" height="16"/>
                <rect x="14" y="4" width="4" height="16"/>
              </svg>
            </button>
            <button
              v-if="copyableContent"
              class="copy-bubble-btn"
              @click="copyBubbleContent"
              :title="t('chat.copyBubble')"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
            <span class="message-time">{{ timeStr }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
  <Teleport to="body">
    <div v-if="previewUrl" class="image-preview-overlay" @click.self="previewUrl = null">
      <img :src="previewUrl" class="image-preview-img" @click="previewUrl = null" />
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.message {
  display: flex;
  flex-direction: column;
  position: relative;

  &.user {
    align-items: flex-end;

    .msg-body {
      max-width: 75%;
      position: relative;
      z-index: 1;
    }

    .msg-content.user {
      align-items: flex-end;
    }

    .message-bubble {
      background-color: $msg-user-bg;
      border-radius: 10px;
    }
  }

  &.assistant {
    flex-direction: row;
    align-items: flex-start;
    gap: 8px;

    .msg-body {
      max-width: 80%;
      position: relative;
      z-index: 1;
    }

    .msg-avatar {
      width: 40px;
      height: 40px;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .message-bubble {
      background-color: $msg-assistant-bg;
      border-radius: 10px;
    }
  }

  &.tool {
    align-items: flex-start;
  }

  &.system {
    align-items: flex-start;
  }

  &.highlight {
    .message-bubble {
      box-shadow: 0 0 0 1px rgba(var(--accent-primary-rgb), 0.45);
    }
  }
}

@keyframes gradient-flow {
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0% 50%;
  }
}

.msg-body {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 85%;
}

.msg-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.message-bubble {
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.65;
  word-break: break-word;
  border-radius: 10px;
  max-width: 100%;
  position: relative;
  box-sizing: border-box;

  &.system {
    border-left: 3px solid $warning;
    border-radius: $radius-sm;
    max-width: 80%;
    background-color: rgba(var(--warning-rgb), 0.06);
  }

  &.speech-playing {
    box-shadow:
      0 0 0 2px #ff6b6b,
      0 0 10px rgba(255, 107, 107, 0.4),
      0 0 20px rgba(255, 107, 107, 0.2);
    animation: rainbow-glow 4s linear infinite;
  }
}

@keyframes rainbow-glow {
  0% {
    box-shadow:
      0 0 0 2px #ff6b6b,
      0 0 10px rgba(255, 107, 107, 0.4),
      0 0 20px rgba(255, 107, 107, 0.2);
  }
  16.66% {
    box-shadow:
      0 0 0 2px #feca57,
      0 0 10px rgba(254, 202, 87, 0.4),
      0 0 20px rgba(254, 202, 87, 0.2);
  }
  33.33% {
    box-shadow:
      0 0 0 2px #48dbfb,
      0 0 10px rgba(72, 219, 251, 0.4),
      0 0 20px rgba(72, 219, 251, 0.2);
  }
  50% {
    box-shadow:
      0 0 0 2px #ff9ff3,
      0 0 10px rgba(255, 159, 243, 0.4),
      0 0 20px rgba(255, 159, 243, 0.2);
  }
  66.66% {
    box-shadow:
      0 0 0 2px #54a0ff,
      0 0 10px rgba(84, 160, 255, 0.4),
      0 0 20px rgba(84, 160, 255, 0.2);
  }
  83.33% {
    box-shadow:
      0 0 0 2px #5f27cd,
      0 0 10px rgba(95, 39, 205, 0.4),
      0 0 20px rgba(95, 39, 205, 0.2);
  }
  100% {
    box-shadow:
      0 0 0 2px #ff6b6b,
      0 0 10px rgba(255, 107, 107, 0.4),
      0 0 20px rgba(255, 107, 107, 0.2);
  }
}

.msg-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.msg-attachment {
  border-radius: $radius-sm;
  overflow: hidden;
  background-color: rgba(0, 0, 0, 0.04);
  border: 1px solid $border-light;

  &.image {
    max-width: 200px;
  }
}

.msg-attachment-thumb {
  display: block;
  max-width: 200px;
  max-height: 160px;
  object-fit: contain;
  cursor: pointer;
}

.msg-attachment-file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 12px;
  color: $text-secondary;

  .att-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 160px;
  }

  .att-size {
    color: $text-muted;
    font-size: 11px;
    flex-shrink: 0;
  }
}

.thinking-block {
  margin-bottom: 8px;
  padding: 4px 0;
  border-bottom: 1px dashed $border-light;

  .thinking-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: $text-muted;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: $radius-sm;
    user-select: none;

    &:hover {
      background: rgba(0, 0, 0, 0.03);
    }
  }

  .thinking-chevron {
    flex-shrink: 0;
    transition: transform 0.15s ease;

    &.rotated {
      transform: rotate(90deg);
    }
  }

  .thinking-icon {
    font-size: 11px;
    flex-shrink: 0;
  }

  .thinking-label {
    font-weight: 500;
    flex-shrink: 0;
  }

  .thinking-meta {
    color: $text-muted;
    font-variant-numeric: tabular-nums;
  }

  .thinking-body {
    margin-top: 6px;
    padding: 6px 10px;
    border-left: 2px solid $border-light;
    font-size: 13px;
    opacity: 0.85;
    font-style: italic;

    :deep(p) { margin: 0.3em 0; }
  }
}

.message-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  padding: 0 4px;
  opacity: 0;
  transition: opacity 0.15s ease;

  .message:hover & {
    opacity: 1;
  }

  // 移动端一直显示按钮
  @media (max-width: 768px) {
    opacity: 1;
  }
}

.copy-bubble-btn,
.speech-bubble-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: $text-muted;
  cursor: pointer;
  border-radius: $radius-sm;
  padding: 0;
  transition: color 0.15s ease, background 0.15s ease;

  &:hover {
    color: $text-secondary;
    background: rgba(0, 0, 0, 0.06);
  }

  .dark & {
    color: #999999;

    &:hover {
      color: #cccccc;
      background: rgba(255, 255, 255, 0.1);
    }
  }
}

.speech-bubble-btn {
  &.playing {
    color: var(--accent-primary);
    animation: pulse 1.5s ease-in-out infinite;

    &.paused {
      animation: none;
      opacity: 0.6;
    }
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.message-time {
  font-size: 11px;
  color: $text-muted;
  user-select: none;

  .dark & {
    color: #999999;
  }
}

.tool-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: $text-secondary;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid $border-light;
  background: rgba(0, 0, 0, 0.02);

  &.expandable {
    cursor: pointer;

    &:hover {
      border-color: rgba(var(--accent-primary-rgb), 0.3);
    }
  }

  &.skill-tool {
    border-left: 2px solid #8b5cf6;
  }

  .tool-name {
    font-family: $font-code;
    flex-shrink: 0;
    color: $text-primary;
  }

  .tool-preview {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 300px;
    color: $text-muted;
  }

  .tool-status-inline {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-left: auto;

    .status-label {
      font-size: 10px;
      color: $text-muted;
      text-transform: lowercase;
    }
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;

    &.running {
      background: #f59e0b;
      animation: pulse 1.2s ease-in-out infinite;
    }

    &.done {
      background: #22c55e;
    }

    &.error {
      background: #ef4444;
    }
  }
}

.tool-chevron {
  flex-shrink: 0;
  color: $text-muted;
  transition: transform 0.2s ease;

  &.rotated {
    transform: rotate(90deg);
  }
}

.tool-icon-badge {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
}

.icon-search {
  background: #1a2744;
}

.icon-web {
  background: #1d2e27;
}

.icon-file {
  background: #2e2314;
}

.icon-code {
  background: #27213a;
}

.icon-skill {
  background: #221d30;
}

.icon-default {
  background: rgba(0, 0, 0, 0.08);
}

.tool-error-badge {
  font-size: 9px;
  color: $error;
  background: rgba(var(--error-rgb), 0.08);
  padding: 0 4px;
  border-radius: 3px;
  line-height: 14px;
  margin-left: 4px;
}

.tool-details {
  margin-top: 6px;
  border: 1px solid $border-light;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.02);
}

.tool-detail-section {
  padding: 8px 12px;
}

.tool-detail-section + .tool-detail-section {
  border-top: 1px solid $border-light;
}

.tool-detail-label {
  font-size: 10px;
  font-weight: 600;
  color: $text-muted;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin-bottom: 2px;
}

.tool-detail-code-block {
  :deep(.hljs-code-block) {
    margin: 0;
  }

  :deep(.code-header) {
    background: rgba(0, 0, 0, 0.02);
  }

  :deep(code.hljs) {
    font-size: 11px;
    max-height: 260px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
}

.tool-progress-bar {
  height: 2px;
  background: rgba(0, 0, 0, 0.08);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 8px;
}

.tool-progress-fill {
  display: block;
  height: 100%;
  width: 35%;
  background: linear-gradient(90deg, var(--accent-primary), #8b5cf6);
  animation: progress-run 1.6s ease-in-out infinite;
}

.tool-streaming-text {
  font-family: $font-code;
  font-size: 11px;
  color: $text-secondary;

  &::after {
    content: "▋";
    color: var(--accent-primary);
    animation: blink 0.8s step-end infinite;
    margin-left: 2px;
  }
}

.result-success {
  border-left: 2px solid #22c55e;
}

.result-error {
  border-left: 2px solid #ef4444;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes progress-run {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(340%);
  }
}

.streaming-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background-color: $text-muted;
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: blink 0.8s infinite;
}

.streaming-dots {
  display: flex;
  gap: 4px;
  padding: 4px 0;

  span {
    width: 6px;
    height: 6px;
    background-color: $text-muted;
    border-radius: 50%;
    animation: pulse 1.4s infinite ease-in-out;

    &:nth-child(2) { animation-delay: 0.2s; }
    &:nth-child(3) { animation-delay: 0.4s; }
  }
}

@keyframes blink {
  0%,
  50% {
    opacity: 1;
  }
  51%,
  100% {
    opacity: 0;
  }
}

@keyframes pulse {
  0%,
  80%,
  100% {
    opacity: 0.3;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}

.image-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.image-preview-img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 4px;
}

@media (max-width: $breakpoint-mobile) {
  .message.user .msg-body {
    max-width: 100%;
  }

  .message.assistant .msg-body {
    max-width: 100%;
  }

  .message.system .msg-body {
    max-width: 100%;
  }
}

/* ===== 新的 Assistant 结构（参考 tool.html） ===== */
.assistant-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  width: 100%;
}

.assistant-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4f8ef7 0%, #a78bfa 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
  margin-top: 2px;
  box-shadow: 0 0 0 1px #2a2d35;
  color: #fff;
}

.assistant-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  max-width: calc(100% - 42px);
}

.process-box {
  border: 1px solid #2a2d35;
  background: linear-gradient(180deg, #10131a 0%, #0f1117 100%);
  border-radius: 12px;
  padding: 10px;
  box-shadow: inset 0 0 0 1px rgba(79, 142, 247, 0.08);
}

.process-title {
  font-family: $font-code;
  font-size: 10px;
  color: #9fb5e9;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 8px;
}

.process-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.process-note {
  font-size: 12px;
  line-height: 1.6;
  color: #c8cde0;
  padding: 4px 4px 8px;
  margin-bottom: 2px;
}

/* ===== 工具气泡（严格按照 tool.html） ===== */
.tool-bubble {
  --surface: #16181c;
  --surface2: #1e2026;
  --border: #2a2d35;
  --border-light: #343840;
  --text-primary: #e8eaf0;
  --text-secondary: #8b8fa8;
  --text-muted: #555870;
  --blue: #4f8ef7;
  --green: #3ecf8e;
  --amber: #f5a623;
  --red: #f06292;
  --purple: #a78bfa;

  background: var(--surface);
  border: 1px solid #4b556d;
  border-radius: 10px;
  overflow: hidden;
  font-size: 13px;
  transition: border-color 0.2s, box-shadow 0.2s;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.25);

  &:hover {
    border-color: #7f8aa4;
    box-shadow: 0 0 0 1px rgba(127, 138, 164, 0.25);
  }
}

/* 按工具类型分色：黄/绿/蓝/红 */
.tool-bubble.icon-search {
  border-color: #d8a031;
  box-shadow: inset 0 0 0 1px rgba(216, 160, 49, 0.18);
  &:hover {
    border-color: #f5b942;
    box-shadow:
      0 0 0 1px rgba(245, 185, 66, 0.3),
      0 0 16px rgba(245, 185, 66, 0.14);
  }
}

.tool-bubble.icon-web {
  border-color: #2f8f66;
  box-shadow: inset 0 0 0 1px rgba(47, 143, 102, 0.18);
  &:hover {
    border-color: #3ecf8e;
    box-shadow:
      0 0 0 1px rgba(62, 207, 142, 0.3),
      0 0 16px rgba(62, 207, 142, 0.14);
  }
}

.tool-bubble.icon-code {
  border-color: #3d73c9;
  box-shadow: inset 0 0 0 1px rgba(61, 115, 201, 0.18);
  &:hover {
    border-color: #4f8ef7;
    box-shadow:
      0 0 0 1px rgba(79, 142, 247, 0.3),
      0 0 16px rgba(79, 142, 247, 0.14);
  }
}

.tool-bubble.icon-file {
  border-color: #c38a2a;
  box-shadow: inset 0 0 0 1px rgba(195, 138, 42, 0.18);
  &:hover {
    border-color: #f5a623;
    box-shadow:
      0 0 0 1px rgba(245, 166, 35, 0.3),
      0 0 16px rgba(245, 166, 35, 0.14);
  }
}

.tool-bubble.icon-skill {
  border-color: #cf4b63;
  box-shadow: inset 0 0 0 1px rgba(207, 75, 99, 0.18);
  &:hover {
    border-color: #f06292;
    box-shadow:
      0 0 0 1px rgba(240, 98, 146, 0.3),
      0 0 16px rgba(240, 98, 146, 0.14);
  }
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 13px;
  cursor: pointer;
  user-select: none;
}

.tool-icon {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;

  &.icon-search {
    background: #1a2744;
    color: var(--blue);
  }

  &.icon-web {
    background: #1d2e27;
    color: var(--green);
  }

  &.icon-code {
    background: #27213a;
    color: var(--purple);
  }

  &.icon-file {
    background: #2e2314;
    color: var(--amber);
  }

  &.icon-skill {
    background: #221d30;
    color: var(--purple);
  }

  &.icon-default {
    background: #23252b;
    color: var(--text-secondary);
  }
}

.tool-name {
  font-family: $font-code;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
}

.tool-status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-family: $font-code;

  .status-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;

    &.running {
      background: var(--amber);
      animation: tool-pulse 1.2s ease-in-out infinite;
    }

    &.done {
      background: var(--green);
    }

    &.error {
      background: var(--red);
    }
  }

  .status-label {
    color: var(--text-secondary);
    text-transform: lowercase;
  }

  .duration {
    font-family: $font-code;
    font-size: 10.5px;
    color: var(--text-muted);
    margin-left: 2px;
  }
}

.chevron {
  color: var(--text-muted);
  font-size: 10px;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  margin-left: 2px;
}

.tool-bubble.open .chevron {
  transform: rotate(180deg);
}

.tool-divider {
  height: 1px;
  background: var(--border);
  margin: 0 13px;
}

.tool-body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

.tool-bubble.open .tool-body {
  grid-template-rows: 1fr;
}

.tool-body-inner {
  overflow: hidden;
}

.tool-section {
  padding: 9px 13px 11px;

  & + .tool-section {
    border-top: 1px solid var(--border);
  }
}

.section-label {
  font-family: $font-code;
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 7px;
}

.param-block,
.result-block {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 9px 11px;
  font-family: $font-code;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-secondary);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;

  :deep(.param-key) { color: var(--purple); }
  :deep(.param-str) { color: var(--green); }
  :deep(.param-num) { color: var(--amber); }
  :deep(.param-keyword) { color: var(--red); font-style: italic; }

  &.success {
    border-left: 2px solid var(--green);
  }

  &.error-r {
    border-left: 2px solid var(--red);
    color: var(--red);
  }

  &.stream-text::after {
    content: '▋';
    animation: blink 0.8s step-end infinite;
    color: var(--blue);
    font-size: 10px;
    margin-left: 1px;
  }
}

/* ===== 美化后的 JSON 键值对展示（用于旧版 tool-line 展开区） ===== */
.pretty-param-block {
  font-family: $font-code;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  padding: 2px 0;
}

.pretty-param-block .param-key {
  color: #a78bfa;
}

.pretty-param-block .param-str {
  color: #3ecf8e;
}

.pretty-param-block .param-num {
  color: #f5a623;
}

.pretty-param-block .param-keyword {
  color: #f06292;
  font-style: italic;
}

.progress-bar {
  height: 2px;
  background: var(--border);
  border-radius: 1px;
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-fill {
  display: block;
  height: 100%;
  width: 35%;
  background: linear-gradient(90deg, var(--blue), var(--purple));
  animation: tool-progress 1.6s ease-in-out infinite;
}

@keyframes tool-pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.75);
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

/* ===== 回复内容框 ===== */
.reply-block {
  font-size: 14px;
  line-height: 1.75;
  color: var(--text-primary);
  padding: 4px 2px;

  :deep(p) {
    margin-bottom: 10px;

    &:last-child {
      margin-bottom: 0;
    }
  }

  :deep(strong) {
    color: #e8eaf0;
    font-weight: 600;
  }

  :deep(code) {
    font-family: $font-code;
    font-size: 12px;
    background: #1e2026;
    border: 1px solid #2a2d35;
    border-radius: 4px;
    padding: 1px 6px;
    color: #a78bfa;
  }
}

/* ===== 操作栏 ===== */
.action-bar {
  display: flex;
  gap: 6px;
  margin-top: 2px;
  padding-left: 2px;
}

.action-btn {
  background: none;
  border: none;
  color: #555870;
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 5px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  transition: color 0.15s, background 0.15s;
  display: flex;
  align-items: center;
  gap: 4px;

  &:hover {
    color: #8b8fa8;
    background: #16181c;
  }

  &.playing {
    color: var(--accent-primary);
  }
}
</style>
