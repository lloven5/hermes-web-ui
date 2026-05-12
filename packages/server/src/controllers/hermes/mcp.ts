import type { Context } from 'koa'
import YAML from 'js-yaml'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { getActiveConfigPath } from '../../services/hermes/hermes-profile'
import { logger } from '../../services/logger'
import { resolveUpstream } from '../../routes/hermes/proxy-handler'
import { proxy } from '../../routes/hermes/proxy-handler'

// MCP Server config from config.yaml
export interface MCPServerConfig {
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  transport?: 'http' | 'stdio'
  auth?: string
  enabled?: boolean
  tools?: string[]
  timeout?: number
  [key: string]: any
}

export interface MCPServerWithStatus extends MCPServerConfig {
  name: string
  enabled: boolean
  connected: boolean
  tool_count: number
}

export interface MCPServerListResponse {
  servers: MCPServerWithStatus[]
  total: number
}

export interface MCPServerResponse extends MCPServerWithStatus {}

export interface MCPToolInfo {
  name: string
  description: string
}

export interface MCPServerTestResult {
  name: string
  success: boolean
  connected: boolean
  tool_count: number
  tools: MCPToolInfo[]
  error?: string
  message?: string
}

export interface MCPReloadResult {
  success: boolean
  connected_servers: number
  failed_servers: number
  registered_tools: number
  message: string
}

export interface MCPStatusResponse {
  total_servers: number
  connected_servers: number
  disconnected_servers: number
  total_tools: number
  servers: MCPServerWithStatus[]
}

export interface MCPServerToolsResponse {
  name: string
  tools: MCPToolInfo[]
  total: number
}

export interface MCCAllToolsResponse {
  tools: MCPToolInfo[]
  total: number
  servers_connected: number
}

export interface MCPServerCreateRequest {
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  transport?: string
  auth?: string
  enabled?: boolean
  tools?: string[]
  timeout?: number
}

export interface MCPServerUpdateRequest {
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  transport?: string
  auth?: string
  enabled?: boolean
  tools?: string[]
  timeout?: number
}

/** Read MCP servers from config.yaml */
async function readMCPServers(): Promise<Record<string, MCPServerConfig>> {
  try {
    const configPath = getActiveConfigPath()
    if (!existsSync(configPath)) {
      return {}
    }
    const content = await readFile(configPath, 'utf-8')
    const config = YAML.load(content) as any
    return config?.mcp_servers || {}
  } catch (err) {
    logger.error('Failed to read MCP servers from config: %s', String(err))
    return {}
  }
}

/** Write MCP servers to config.yaml */
async function writeMCPServers(servers: Record<string, MCPServerConfig>): Promise<void> {
  try {
    const configPath = getActiveConfigPath()
    let config: any = {}
    
    if (existsSync(configPath)) {
      const content = await readFile(configPath, 'utf-8')
      config = YAML.load(content) || {}
    }
    
    if (Object.keys(servers).length === 0) {
      delete config.mcp_servers
    } else {
      config.mcp_servers = servers
    }
    
    await writeFile(configPath, YAML.dump(config), 'utf-8')
  } catch (err) {
    logger.error('Failed to write MCP servers to config: %s', String(err))
    throw err
  }
}

/** In-memory cache for test results */
interface TestResultCache {
  connected: boolean
  tool_count: number
  timestamp: number
}

const testResultCache = new Map<string, TestResultCache>()

/** Save test result to cache */
function cacheTestResult(name: string, connected: boolean, tool_count: number): void {
  testResultCache.set(name, {
    connected,
    tool_count,
    timestamp: Date.now(),
  })
}

/** Get cached test result */
function getCachedTestResult(name: string): TestResultCache | undefined {
  return testResultCache.get(name)
}

/** Clear test result from cache */
function clearCachedTestResult(name: string): void {
  testResultCache.delete(name)
}

/** Convert config to response with cached status */
function configToResponse(name: string, config: MCPServerConfig): MCPServerWithStatus {
  const cached = getCachedTestResult(name)
  return {
    name,
    url: config.url,
    command: config.command,
    args: config.args,
    env: config.env,
    headers: config.headers,
    transport: config.transport || (config.url ? 'http' : 'stdio'),
    auth: config.auth,
    enabled: config.enabled ?? true,
    tools: config.tools,
    timeout: config.timeout ?? 30,
    connected: cached?.connected ?? false,
    tool_count: cached?.tool_count ?? 0,
  }
}

// ─── API Controllers ────────────────────────────────────────────────────────

export async function list(ctx: Context): Promise<void> {
  const servers = await readMCPServers()
  const response: MCPServerListResponse = {
    servers: Object.entries(servers).map(([name, config]) => configToResponse(name, config)),
    total: Object.keys(servers).length,
  }
  ctx.body = response
}

export async function get(ctx: Context): Promise<void> {
  const { name } = ctx.params
  const servers = await readMCPServers()
  
  if (!servers[name]) {
    ctx.status = 404
    ctx.body = { detail: `MCP server '${name}' not found` }
    return
  }
  
  ctx.body = configToResponse(name, servers[name])
}

export async function create(ctx: Context): Promise<void> {
  try {
    const { name } = ctx.params
    const body = ctx.request.body as MCPServerCreateRequest
    
    // Validate name
    if (!name || !name.trim()) {
      ctx.status = 400
      ctx.body = { detail: "Server name cannot be empty" }
      return
    }
    if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
      ctx.status = 400
      ctx.body = { detail: "Server name must be alphanumeric (dashes and underscores allowed)" }
      return
    }
    
    const servers = await readMCPServers()
    
    if (servers[name]) {
      ctx.status = 409
      ctx.body = { detail: `MCP server '${name}' already exists` }
      return
    }
    
    // Validate transport configuration
    if (body.command) {
      body.transport = 'stdio'
    } else if (!body.url) {
      ctx.status = 400
      ctx.body = { detail: "Either 'url' or 'command' must be provided" }
      return
    }
    
    // Build server config
    const serverConfig: MCPServerConfig = {}
    if (body.url !== undefined) serverConfig.url = body.url
    if (body.command !== undefined) serverConfig.command = body.command
    if (body.args !== undefined) serverConfig.args = body.args
    if (body.env !== undefined) serverConfig.env = body.env
    if (body.headers !== undefined) serverConfig.headers = body.headers
    if (body.transport !== undefined) serverConfig.transport = body.transport as 'http' | 'stdio'
    if (body.auth !== undefined) serverConfig.auth = body.auth
    if (body.enabled !== undefined) serverConfig.enabled = body.enabled
    if (body.tools !== undefined) serverConfig.tools = body.tools
    if (body.timeout !== undefined) serverConfig.timeout = body.timeout
    
    servers[name] = serverConfig
    await writeMCPServers(servers)
    
    // Auto-test HTTP servers on create - 通过 hermes-agent 测试
    const isHttpServer = serverConfig.transport === 'http' || !!serverConfig.url
    if (isHttpServer && serverConfig.url) {
      try {
        const timeout = serverConfig.timeout ?? 30
        const upstream = resolveUpstream(ctx)
        const testUrl = `${upstream}/api/mcp/servers/${encodeURIComponent(name)}/test?timeout=${timeout}`
        const response = await fetch(testUrl, {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
        })
        const data = await response.json()
        if (response.ok && data.success && data.connected) {
          cacheTestResult(name, true, data.tool_count ?? 0)
          // Auto-connect after successful test to establish persistent connection
          const connectUrl = `${upstream}/api/mcp/servers/${encodeURIComponent(name)}/connect?timeout=${timeout}`
          try {
            await fetch(connectUrl, {
              method: 'POST',
              headers: { 'Accept': 'application/json' },
            })
          } catch (connectErr) {
            logger.warn('Auto-connect after create test failed for MCP server %s: %s', name, String(connectErr))
          }
        }
      } catch (err) {
        // Test failed - leave as disconnected, clear any cached result
        logger.warn('Auto-test failed for MCP server %s: %s', name, String(err))
        clearCachedTestResult(name)
      }
    }
    
    ctx.status = 201
    ctx.body = configToResponse(name, serverConfig)
  } catch (err) {
    logger.error('Failed to create MCP server: %s', String(err))
    ctx.status = 500
    ctx.body = { detail: `Failed to create MCP server: ${String(err)}` }
  }
}

export async function update(ctx: Context): Promise<void> {
  const { name } = ctx.params
  const body = ctx.request.body as MCPServerUpdateRequest
  
  const servers = await readMCPServers()
  
  if (!servers[name]) {
    ctx.status = 404
    ctx.body = { detail: `MCP server '${name}' not found` }
    return
  }
  
  // Update fields if provided
  const serverConfig = { ...servers[name] }
  if (body.url !== undefined) serverConfig.url = body.url
  if (body.command !== undefined) serverConfig.command = body.command
  if (body.args !== undefined) serverConfig.args = body.args
  if (body.env !== undefined) serverConfig.env = body.env
  if (body.headers !== undefined) serverConfig.headers = body.headers
  if (body.transport !== undefined) serverConfig.transport = body.transport as 'http' | 'stdio'
  if (body.auth !== undefined) serverConfig.auth = body.auth
  if (body.enabled !== undefined) serverConfig.enabled = body.enabled
  if (body.tools !== undefined) serverConfig.tools = body.tools
  if (body.timeout !== undefined) serverConfig.timeout = body.timeout
  
  servers[name] = serverConfig
  await writeMCPServers(servers)
  
  ctx.body = configToResponse(name, serverConfig)
}

export async function remove(ctx: Context): Promise<void> {
  const { name } = ctx.params
  
  const servers = await readMCPServers()
  
  if (!servers[name]) {
    ctx.status = 404
    ctx.body = { detail: `MCP server '${name}' not found` }
    return
  }
  
  delete servers[name]
  await writeMCPServers(servers)
  
  // Clear cached test result
  clearCachedTestResult(name)
  
  ctx.status = 204
}

export async function test(ctx: Context): Promise<void> {
  const { name } = ctx.params
  const timeout = parseFloat(ctx.query.timeout as string) || 30.0
  
  const servers = await readMCPServers()
  
  if (!servers[name]) {
    ctx.status = 404
    ctx.body = { detail: `MCP server '${name}' not found` }
    return
  }
  
  // All servers (HTTP and stdio) 统一请求 hermes-agent 进行测试
  const upstream = resolveUpstream(ctx)
  const testUrl = `${upstream}/api/mcp/servers/${encodeURIComponent(name)}/test?timeout=${timeout}`
  
  try {
    const response = await fetch(testUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
      },
    })
    
    const testData = await response.json()
    
    if (response.ok && testData.success && testData.connected) {
      // Test successful - the MCP server's _probe_single_server creates a
      // temporary connection that closes after getting tools. To keep the
      // server "connected" in UI, we need to establish a persistent connection
      // by calling the connect endpoint.
      cacheTestResult(name, true, testData.tool_count ?? 0)
      
      // Now establish a persistent connection via connect endpoint
      const connectUrl = `${upstream}/api/mcp/servers/${encodeURIComponent(name)}/connect?timeout=${timeout}`
      try {
        await fetch(connectUrl, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
          },
        })
      } catch (connectErr) {
        // Connect failed, but test was successful - still return success
        logger.warn('Auto-connect after test failed for MCP server %s: %s', name, String(connectErr))
      }
      
      ctx.body = testData
    } else {
      // Test failed - clear any cached result
      clearCachedTestResult(name)
      ctx.status = response.ok ? response.status : 500
      ctx.body = testData
    }
  } catch (err) {
    logger.error('Failed to test MCP server %s: %s', name, String(err))
    ctx.status = 502
    ctx.body = {
      name,
      success: false,
      connected: false,
      tool_count: 0,
      tools: [],
      error: `Failed to test: ${String(err)}`,
    }
  }
}


export async function getTools(ctx: Context): Promise<void> {
  const { name } = ctx.params
  const timeout = parseFloat(ctx.query.timeout as string) || 30
  
  const servers = await readMCPServers()
  
  if (!servers[name]) {
    ctx.status = 404
    ctx.body = { detail: `MCP server '${name}' not found` }
    return
  }
  
  const serverConfig = servers[name]
  
  // Check if server is disabled
  if (serverConfig.enabled === false) {
    ctx.body = {
      name,
      tools: [],
      total: 0,
      connected: false,
      message: 'Server is disabled',
    }
    return
  }
  
  // All servers (HTTP and stdio)统一请求 hermes-agent 获取 tools
  const upstream = resolveUpstream(ctx)
  const url = `${upstream}/api/mcp/servers/${encodeURIComponent(name)}/tools`
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    })
    const data = await response.json()
    ctx.body = data
  } catch (err) {
    ctx.status = 500
    ctx.body = {
      name,
      tools: [],
      total: 0,
      error: String(err),
    }
  }
}

export async function reload(ctx: Context): Promise<void> {
  // This would typically restart the MCP servers in the gateway
  // For now, just return a success response
  const servers = await readMCPServers()
  const serverList = Object.values(servers)
  
  const result: MCPReloadResult = {
    success: true,
    connected_servers: serverList.filter(s => s.enabled !== false).length,
    failed_servers: 0,
    registered_tools: 0,
    message: "MCP reload placeholder - actual reload requires gateway restart",
  }
  
  ctx.body = result
}

export async function status(ctx: Context): Promise<void> {
  const servers = await readMCPServers()
  const serverList = Object.values(servers)
  const enabledServers = serverList.filter(s => s.enabled !== false)
  const disabledServers = serverList.filter(s => s.enabled === false)
  
  const response: MCPStatusResponse = {
    total_servers: serverList.length,
    connected_servers: 0, // Would be updated with actual connection status
    disconnected_servers: enabledServers.length, // Assume disconnected until proven otherwise
    total_tools: 0, // Would be updated with actual tool count
    servers: Object.entries(servers).map(([name, config]) => configToResponse(name, config)),
  }
  
  ctx.body = response
}

export async function listAllTools(ctx: Context): Promise<void> {
  const servers = await readMCPServers()
  
  // Return empty tools list - actual implementation would query MCP runtime
  const response: MCCAllToolsResponse = {
    tools: [],
    total: 0,
    servers_connected: 0,
  }
  
  ctx.body = response
}

/**
 * Connect to an MCP server (primarily for stdio servers)
 */
export async function connect(ctx: Context): Promise<void> {
  const { name } = ctx.params
  const timeout = parseFloat(ctx.query.timeout as string) || 30.0
  
  const servers = await readMCPServers()
  
  if (!servers[name]) {
    ctx.status = 404
    ctx.body = { detail: `MCP server '${name}' not found` }
    return
  }
  
  const upstream = resolveUpstream(ctx)
  const url = `${upstream}/api/mcp/servers/${encodeURIComponent(name)}/connect?timeout=${timeout}`
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
      },
    })
    
    const data = await response.json()
    
    if (response.ok) {
      // Cache the result if connected
      if (data.success && data.connected) {
        cacheTestResult(name, true, data.tool_count ?? 0)
      }
      ctx.body = data
    } else {
      ctx.status = response.status
      ctx.body = data
    }
  } catch (err) {
    logger.error('Failed to connect MCP server %s: %s', name, String(err))
    ctx.status = 502
    ctx.body = {
      name,
      success: false,
      connected: false,
      tool_count: 0,
      error: `Failed to connect: ${String(err)}`,
    }
  }
}

/**
 * Disconnect from an MCP server
 */
export async function disconnect(ctx: Context): Promise<void> {
  const { name } = ctx.params
  
  const servers = await readMCPServers()
  
  if (!servers[name]) {
    ctx.status = 404
    ctx.body = { detail: `MCP server '${name}' not found` }
    return
  }
  
  const upstream = resolveUpstream(ctx)
  const url = `${upstream}/api/mcp/servers/${encodeURIComponent(name)}/disconnect`
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
      },
    })
    
    const data = await response.json()
    
    if (response.ok) {
      // Clear cached result
      clearCachedTestResult(name)
      ctx.body = data
    } else {
      ctx.status = response.status
      ctx.body = data
    }
  } catch (err) {
    logger.error('Failed to disconnect MCP server %s: %s', name, String(err))
    ctx.status = 502
    ctx.body = {
      name,
      success: false,
      connected: false,
      error: `Failed to disconnect: ${String(err)}`,
    }
  }
}

/**
 * Start (connect) an MCP server
 */
export async function startServer(ctx: Context): Promise<void> {
  const { name } = ctx.params
  
  const servers = await readMCPServers()
  
  if (!servers[name]) {
    ctx.status = 404
    ctx.body = { detail: `MCP server '${name}' not found` }
    return
  }
  
  // Update config to enable server
  servers[name].enabled = true
  await writeMCPServers(servers)
  
  // Clear any cached failure state
  clearCachedTestResult(name)
  
  // Connect to the server
  const upstream = resolveUpstream(ctx)
  const url = `${upstream}/api/mcp/servers/${encodeURIComponent(name)}/connect`
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
    })
    const data = await response.json()
    
    if (response.ok && data.success) {
      ctx.body = {
        success: true,
        message: `MCP server '${name}' started`,
        name,
      }
    } else {
      // Still return success for enabling, even if connect failed
      ctx.body = {
        success: true,
        message: `MCP server '${name}' enabled but connection failed`,
        name,
        connected: false,
        ...data,
      }
    }
  } catch (err) {
    logger.error('Failed to start MCP server %s: %s', name, String(err))
    ctx.body = {
      success: true,
      message: `MCP server '${name}' enabled but connection pending`,
      name,
      connected: false,
    }
  }
}

/**
 * Stop (disconnect) an MCP server
 */
export async function stopServer(ctx: Context): Promise<void> {
  const { name } = ctx.params
  
  const servers = await readMCPServers()
  
  if (!servers[name]) {
    ctx.status = 404
    ctx.body = { detail: `MCP server '${name}' not found` }
    return
  }
  
  // Update config to disable server
  servers[name].enabled = false
  await writeMCPServers(servers)
  
  // Clear cached state
  clearCachedTestResult(name)
  
  // Disconnect from the server
  const upstream = resolveUpstream(ctx)
  const url = `${upstream}/api/mcp/servers/${encodeURIComponent(name)}/disconnect`
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
    })
    const data = await response.json()
    
    if (response.ok) {
      ctx.body = {
        success: true,
        message: `MCP server '${name}' stopped`,
        name,
      }
    } else {
      ctx.body = {
        success: true,
        message: `MCP server '${name}' disabled but disconnect failed`,
        name,
        ...data,
      }
    }
  } catch (err) {
    logger.error('Failed to stop MCP server %s: %s', name, String(err))
    ctx.body = {
      success: true,
      message: `MCP server '${name}' disabled`,
      name,
    }
  }
}

/**
 * Get the connection status of an MCP server
 */
export async function serverStatus(ctx: Context): Promise<void> {
  const { name } = ctx.params
  
  const servers = await readMCPServers()
  
  if (!servers[name]) {
    ctx.status = 404
    ctx.body = { detail: `MCP server '${name}' not found` }
    return
  }
  
  const upstream = resolveUpstream(ctx)
  const url = `${upstream}/api/mcp/servers/${encodeURIComponent(name)}/status`
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    })
    
    const data = await response.json()
    
    if (response.ok) {
      // Cache the status
      if (data.connected) {
        cacheTestResult(name, true, data.tool_count ?? 0)
      } else {
        clearCachedTestResult(name)
      }
      ctx.body = data
    } else {
      ctx.status = response.status
      ctx.body = data
    }
  } catch (err) {
    logger.error('Failed to get MCP server status %s: %s', name, String(err))
    // Return cached status if available
    const cached = getCachedTestResult(name)
    if (cached) {
      ctx.body = {
        name,
        connected: cached.connected,
        tool_count: cached.tool_count,
        transport: servers[name].transport || 'stdio',
        enabled: servers[name].enabled ?? true,
      }
    } else {
      ctx.status = 502
      ctx.body = {
        name,
        connected: false,
        tool_count: 0,
        error: `Failed to get status: ${String(err)}`,
      }
    }
  }
}