<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  NButton,
  NCard,
  NEmpty,
  NInput,
  NSpace,
  NSpin,
  NTag,
  NText,
  NTabs,
  NTabPane,
  NModal,
  NForm,
  NFormItem,
  NSelect,
  NSwitch,
  NPopconfirm,
  useMessage,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type {
  MCPServerConfig,
  MCPServerTestResult,
} from '@/api/hermes/mcp'
import {
  fetchMCPServers,
  createMCPServer,
  updateMCPServer,
  deleteMCPServer,
  testMCPServer,
  reloadMCPServers,
  fetchMCPStatus,
  connectMCPServer,
  disconnectMCPServer,
} from '@/api/hermes/mcp'

type TransportType = 'http' | 'stdio'

const { t } = useI18n()
const message = useMessage()

// State
const loading = ref(false)
const servers = ref<MCPServerConfig[]>([])
const statusInfo = ref<{ connected_servers: number; total_servers: number; total_tools: number } | null>(null)
const searchQuery = ref('')
const selectedServer = ref<MCPServerConfig | null>(null)
const showAddModal = ref(false)
const showEditModal = ref(false)
const testingServer = ref<string | null>(null)
const testResults = ref<Record<string, MCPServerTestResult>>({})
const activeTab = ref('servers')

// Add/Edit form state
const formName = ref('')
const formUrl = ref('')
const formCommand = ref('')
const formArgs = ref('')
const formTransport = ref<TransportType>('http')
const formEnabled = ref(true)
const formHeaders = ref('')
const formTimeout = ref('30')
const isSubmitting = ref(false)

// Computed
const filteredServers = computed(() => {
  if (!searchQuery.value) return servers.value
  const query = searchQuery.value.toLowerCase()
  return servers.value.filter(
    s => s.name.toLowerCase().includes(query) ||
         s.url?.toLowerCase().includes(query) ||
         s.command?.toLowerCase().includes(query)
  )
})

// Methods
async function loadServers() {
  loading.value = true
  try {
    const data = await fetchMCPServers()
    servers.value = data.servers
    // Also fetch status for quick overview
    try {
      const status = await fetchMCPStatus()
      statusInfo.value = {
        connected_servers: status.connected_servers,
        total_servers: status.total_servers,
        total_tools: status.total_tools,
      }
    } catch {
      // Status endpoint may not be available
    }
  } catch (err: any) {
    message.error(t('mcp.loadError') + ': ' + (err.message || 'Unknown error'))
  } finally {
    loading.value = false
  }
}

async function handleReload() {
  loading.value = true
  try {
    const result = await reloadMCPServers()
    message.success(result.message)
    await loadServers()
  } catch (err: any) {
    message.error(t('mcp.reloadError') + ': ' + (err.message || 'Unknown error'))
  } finally {
    loading.value = false
  }
}

async function handleTest(name: string) {
  testingServer.value = name
  testResults.value[name] = { success: false, connected: false, tool_count: 0, tools: [], name, error: '' }
  try {
    const result = await testMCPServer(name)
    testResults.value[name] = result
    if (result.success) {
      message.success(t('mcp.testSuccess', { name, count: result.tool_count }))
    } else {
      message.warning(t('mcp.testFailed', { name, error: result.error }))
    }
  } catch (err: any) {
    testResults.value[name] = {
      name,
      success: false,
      connected: false,
      tool_count: 0,
      tools: [],
      error: err.message || 'Unknown error',
    }
    message.error(t('mcp.testError') + ': ' + (err.message || 'Unknown error'))
  } finally {
    testingServer.value = null
  }
}

async function handleDelete(name: string) {
  try {
    await deleteMCPServer(name)
    message.success(t('mcp.deleteSuccess', { name }))
    await loadServers()
    if (selectedServer.value?.name === name) {
      selectedServer.value = null
    }
  } catch (err: any) {
    message.error(t('mcp.deleteError') + ': ' + (err.message || 'Unknown error'))
  }
}

async function handleToggleEnabled(server: MCPServerConfig, enabled: boolean) {
  try {
    await updateMCPServer(server.name, { enabled })
    message.success(enabled ? t('mcp.enabledSuccess') : t('mcp.disabledSuccess'))
    await loadServers()
  } catch (err: any) {
    message.error(t('mcp.toggleError') + ': ' + (err.message || 'Unknown error'))
  }
}

const connectingServer = ref<string | null>(null)
const disconnectingServer = ref<string | null>(null)

async function handleConnect(name: string) {
  connectingServer.value = name
  try {
    const result = await connectMCPServer(name)
    if (result.success) {
      message.success(t('mcp.connectSuccess', { name, count: result.tool_count }))
      await loadServers()
    } else {
      message.warning(t('mcp.connectFailed', { name, error: result.error }))
    }
  } catch (err: any) {
    message.error(t('mcp.connectError') + ': ' + (err.message || 'Unknown error'))
  } finally {
    connectingServer.value = null
  }
}

async function handleDisconnect(name: string) {
  disconnectingServer.value = name
  try {
    const result = await disconnectMCPServer(name)
    if (result.success) {
      message.success(t('mcp.disconnectSuccess', { name }))
      await loadServers()
    } else {
      message.warning(t('mcp.disconnectFailed', { name, error: result.error }))
    }
  } catch (err: any) {
    message.error(t('mcp.disconnectError') + ': ' + (err.message || 'Unknown error'))
  } finally {
    disconnectingServer.value = null
  }
}

function openAddModal() {
  formName.value = ''
  formUrl.value = ''
  formCommand.value = ''
  formArgs.value = ''
  formTransport.value = 'http'
  formEnabled.value = true
  formHeaders.value = ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formTimeout.value = 30 as any
  showAddModal.value = true
}

function openEditModal(server: MCPServerConfig) {
  formName.value = server.name
  formUrl.value = server.url || ''
  formCommand.value = server.command || ''
  formArgs.value = (server.args || []).join(' ')
  formTransport.value = server.transport
  formEnabled.value = server.enabled
  formHeaders.value = server.headers ? JSON.stringify(server.headers, null, 2) : ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formTimeout.value = server.timeout as any
  showEditModal.value = true
}

async function handleAdd() {
  if (!formName.value.trim()) {
    message.warning(t('mcp.nameRequired'))
    return
  }
  if (formTransport.value === 'http' && !formUrl.value.trim()) {
    message.warning(t('mcp.urlRequired'))
    return
  }
  if (formTransport.value === 'stdio' && !formCommand.value.trim()) {
    message.warning(t('mcp.commandRequired'))
    return
  }

  isSubmitting.value = true
  try {
    const config: any = {
      transport: formTransport.value,
      enabled: formEnabled.value,
      timeout: formTimeout.value,
    }
    if (formTransport.value === 'http') {
      config.url = formUrl.value
      if (formHeaders.value.trim()) {
        try {
          config.headers = JSON.parse(formHeaders.value)
        } catch {
          message.warning(t('mcp.invalidHeaders'))
          isSubmitting.value = false
          return
        }
      }
    } else {
      config.command = formCommand.value
      if (formArgs.value.trim()) {
        config.args = formArgs.value.split(/\s+/).filter(Boolean)
      }
    }

    await createMCPServer(formName.value.trim(), config)
    message.success(t('mcp.addSuccess', { name: formName.value }))
    showAddModal.value = false
    await loadServers()
  } catch (err: any) {
    message.error(t('mcp.addError') + ': ' + (err.message || 'Unknown error'))
  } finally {
    isSubmitting.value = false
  }
}

async function handleUpdate() {
  if (!formName.value.trim()) {
    message.warning(t('mcp.nameRequired'))
    return
  }

  isSubmitting.value = true
  try {
    const config: any = {
      transport: formTransport.value,
      enabled: formEnabled.value,
      timeout: formTimeout.value,
    }
    if (formTransport.value === 'http') {
      config.url = formUrl.value
      if (formHeaders.value.trim()) {
        try {
          config.headers = JSON.parse(formHeaders.value)
        } catch {
          message.warning(t('mcp.invalidHeaders'))
          isSubmitting.value = false
          return
        }
      }
    } else {
      config.command = formCommand.value
      if (formArgs.value.trim()) {
        config.args = formArgs.value.split(/\s+/).filter(Boolean)
      }
    }

    await updateMCPServer(formName.value.trim(), config)
    message.success(t('mcp.updateSuccess', { name: formName.value }))
    showEditModal.value = false
    await loadServers()
  } catch (err: any) {
    message.error(t('mcp.updateError') + ': ' + (err.message || 'Unknown error'))
  } finally {
    isSubmitting.value = false
  }
}

function handleTransportChange(value: TransportType) {
  formTransport.value = value
}

onMounted(() => {
  loadServers()
})
</script>

<template>
  <div class="mcp-view">
    <header class="page-header">
      <div class="header-left">
        <h2 class="header-title">{{ t('mcp.title') }}</h2>
        <NTag v-if="statusInfo" size="small" :type="statusInfo.connected_servers > 0 ? 'success' : 'default'">
          {{ statusInfo.connected_servers }}/{{ statusInfo.total_servers }}
        </NTag>
        <NTag v-if="statusInfo && statusInfo.total_tools > 0" size="small" type="info">
          {{ statusInfo.total_tools }} {{ t('mcp.tools') }}
        </NTag>
      </div>
      <div class="header-actions">
        <NInput
          v-model:value="searchQuery"
          :placeholder="t('mcp.search')"
          size="small"
          clearable
          style="width: 180px"
        />
        <NButton size="small" @click="handleReload" :loading="loading">
          <template #icon>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </template>
          {{ t('mcp.reload') }}
        </NButton>
        <NButton type="primary" size="small" @click="openAddModal">
          <template #icon>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </template>
          {{ t('mcp.addServer') }}
        </NButton>
      </div>
    </header>

    <div class="mcp-content">
      <div v-if="loading && servers.length === 0" class="mcp-loading">
        <NSpin size="large" />
        <NText>{{ t('common.loading') }}</NText>
      </div>

      <NEmpty v-else-if="servers.length === 0 && !searchQuery" :description="t('mcp.noServers')">
        <template #extra>
          <NButton size="small" type="primary" @click="openAddModal">
            {{ t('mcp.addFirstServer') }}
          </NButton>
        </template>
      </NEmpty>

      <div v-else class="mcp-grid">
        <NCard
          v-for="server in filteredServers"
          :key="server.name"
          class="server-card"
          :class="{ connected: server.connected, disconnected: !server.connected }"
          hoverable
        >
          <template #header>
            <div class="server-header">
              <div class="server-title">
                <span class="status-dot" :class="{ connected: server.connected }" />
                <span class="server-name">{{ server.name }}</span>
              </div>
              <div class="server-badges">
                <NSwitch
                  size="small"
                  :value="server.enabled !== false"
                  @update:value="(val: boolean) => handleToggleEnabled(server, val)"
                />
                <NTag size="tiny" :type="server.transport === 'http' ? 'info' : 'warning'">
                  {{ server.transport.toUpperCase() }}
                </NTag>
                <NTag v-if="server.connected" size="tiny" type="success">
                  {{ server.tool_count }} {{ t('mcp.tools') }}
                </NTag>
                <NTag v-else size="tiny" type="error">
                  {{ t('mcp.disconnected') }}
                </NTag>
              </div>
            </div>
          </template>

          <div class="server-details">
            <div v-if="server.url" class="detail-row">
              <NText depth="3" class="detail-label">{{ t('mcp.url') }}:</NText>
              <NText class="detail-value">{{ server.url }}</NText>
            </div>
            <div v-if="server.command" class="detail-row">
              <NText depth="3" class="detail-label">{{ t('mcp.command') }}:</NText>
              <NText class="detail-value mono">{{ server.command }}</NText>
            </div>
            <div v-if="server.args?.length" class="detail-row">
              <NText depth="3" class="detail-label">{{ t('mcp.args') }}:</NText>
              <NText class="detail-value mono">{{ server.args.join(' ') }}</NText>
            </div>
          </div>

          <!-- Test Result -->
          <div v-if="testResults[server.name]" class="test-result" :class="{ success: testResults[server.name].success, error: !testResults[server.name].success }">
            <template v-if="testResults[server.name].success">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              {{ t('mcp.testOk', { count: testResults[server.name].tool_count }) }}
            </template>
            <template v-else>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              {{ testResults[server.name].error }}
            </template>
          </div>

          <template #action>
            <NSpace>
              <!-- Test button -->
              <NButton
                size="tiny"
                :loading="testingServer === server.name"
                @click="handleTest(server.name)"
              >
                {{ t('mcp.test') }}
              </NButton>
              
              <NButton size="tiny" @click="openEditModal(server)">
                {{ t('common.edit') }}
              </NButton>
              <NPopconfirm
                @positive-click="handleDelete(server.name)"
              >
                <template #trigger>
                  <NButton size="tiny" type="error">
                    {{ t('common.delete') }}
                  </NButton>
                </template>
                {{ t('mcp.confirmDelete', { name: server.name }) }}
              </NPopconfirm>
            </NSpace>
          </template>
        </NCard>
      </div>
    </div>

    <!-- Add Server Modal -->
    <NModal
      v-model:show="showAddModal"
      preset="card"
      :title="t('mcp.addServer')"
      style="width: 500px; max-width: 90vw;"
      :mask-closable="false"
    >
      <NForm label-placement="top">
        <NFormItem :label="t('mcp.serverName')" required>
          <NInput v-model:value="formName" :placeholder="t('mcp.namePlaceholder')" />
        </NFormItem>

        <NFormItem :label="t('mcp.transport')">
          <NSelect
            v-model:value="formTransport"
            :options="[
              { label: 'HTTP', value: 'http' },
              { label: 'STDIO', value: 'stdio' },
            ]"
            @update:value="handleTransportChange"
          />
        </NFormItem>

        <template v-if="formTransport === 'http'">
          <NFormItem :label="t('mcp.url')" required>
            <NInput v-model:value="formUrl" placeholder="https://api.example.com/mcp" />
          </NFormItem>
          <NFormItem :label="t('mcp.headers')">
            <NInput
              v-model:value="formHeaders"
              type="textarea"
              :rows="2"
              placeholder='{"Authorization": "Bearer xxx"}'
            />
          </NFormItem>
        </template>

        <template v-else>
          <NFormItem :label="t('mcp.command')" required>
            <NInput v-model:value="formCommand" placeholder="npx" />
          </NFormItem>
          <NFormItem :label="t('mcp.args')">
            <NInput v-model:value="formArgs" placeholder="-y @modelcontextprotocol/server-filesystem" />
          </NFormItem>
        </template>

        <NFormItem :label="t('mcp.timeout')">
          <NInput v-model:value="formTimeout" type="text" inputmode="numeric" :min="1" :max="300" />
        </NFormItem>

        <NFormItem :label="t('mcp.enabled')">
          <NSwitch v-model:value="formEnabled" />
        </NFormItem>
      </NForm>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="showAddModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" @click="handleAdd" :loading="isSubmitting">
            {{ t('common.add') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <!-- Edit Server Modal -->
    <NModal
      v-model:show="showEditModal"
      preset="card"
      :title="t('mcp.editServer')"
      style="width: 500px; max-width: 90vw;"
      :mask-closable="false"
    >
      <NForm label-placement="top">
        <NFormItem :label="t('mcp.serverName')">
          <NInput v-model:value="formName" disabled />
        </NFormItem>

        <NFormItem :label="t('mcp.transport')">
          <NSelect
            v-model:value="formTransport"
            :options="[
              { label: 'HTTP', value: 'http' },
              { label: 'STDIO', value: 'stdio' },
            ]"
            @update:value="handleTransportChange"
          />
        </NFormItem>

        <template v-if="formTransport === 'http'">
          <NFormItem :label="t('mcp.url')">
            <NInput v-model:value="formUrl" placeholder="https://api.example.com/mcp" />
          </NFormItem>
          <NFormItem :label="t('mcp.headers')">
            <NInput
              v-model:value="formHeaders"
              type="textarea"
              :rows="2"
              placeholder='{"Authorization": "Bearer xxx"}'
            />
          </NFormItem>
        </template>

        <template v-else>
          <NFormItem :label="t('mcp.command')">
            <NInput v-model:value="formCommand" placeholder="npx" />
          </NFormItem>
          <NFormItem :label="t('mcp.args')">
            <NInput v-model:value="formArgs" placeholder="-y @modelcontextprotocol/server-filesystem" />
          </NFormItem>
        </template>

        <NFormItem :label="t('mcp.timeout')">
          <NInput v-model:value="formTimeout" type="text" inputmode="numeric" :min="1" :max="300" />
        </NFormItem>

        <NFormItem :label="t('mcp.enabled')">
          <NSwitch v-model:value="formEnabled" />
        </NFormItem>
      </NForm>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="showEditModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" @click="handleUpdate" :loading="isSubmitting">
            {{ t('common.save') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.mcp-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  gap: 16px;
  flex-wrap: wrap;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.mcp-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.mcp-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  gap: 16px;
}

.mcp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.server-card {
  transition: all 0.2s;
}

.server-card.connected {
  border-left: 3px solid var(--success-color, #18a058);
}

.server-card.disconnected {
  border-left: 3px solid var(--error-color, #d03050);
}

.server-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.server-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--error-color, #d03050);
}

.status-dot.connected {
  background: var(--success-color, #18a058);
}

.server-name {
  font-weight: 600;
  font-size: 15px;
}

.server-badges {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.server-details {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0;
  padding: 12px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 6px;
}

.detail-row {
  display: flex;
  gap: 8px;
  font-size: 13px;
}

.detail-label {
  flex-shrink: 0;
}

.detail-value {
  word-break: break-all;
}

.detail-value.mono {
  font-family: monospace;
  font-size: 12px;
}

.test-result {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
  margin-top: 8px;
}

.test-result.success {
  background: rgba(24, 160, 88, 0.1);
  color: var(--success-color, #18a058);
}

.test-result.error {
  background: rgba(208, 48, 80, 0.1);
  color: var(--error-color, #d03050);
}
</style>