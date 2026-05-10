import type { Context } from 'koa'
import YAML from 'js-yaml'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import * as http from 'http'
import * as https from 'https'
import { getActiveConfigPath } from '../../services/hermes/hermes-profile'
import { logger } from '../../services/logger'
import { resolveUpstream } from '../../routes/hermes/proxy-handler'

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
    
    // Auto-test HTTP servers on create
    const isHttpServer = serverConfig.transport === 'http' || !!serverConfig.url
    if (isHttpServer && serverConfig.url) {
      try {
        const timeout = serverConfig.timeout ?? 30
        const result = await testHttpMCPServer(serverConfig.url, serverConfig.headers, timeout)
        cacheTestResult(name, result.success, result.tool_count)
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
  
  const serverConfig = servers[name]
  
  // For stdio servers, use the connect API to test
  if (serverConfig.transport !== 'http' || !serverConfig.url) {
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
    return
  }
  
  // For HTTP servers, test directly
  try {
    const result = await testHttpMCPServer(serverConfig.url, serverConfig.headers, timeout)
    // Cache the test result for list API
    cacheTestResult(name, result.success, result.tool_count)
    ctx.body = result
  } catch (err) {
    // Clear cached result on failure
    clearCachedTestResult(name)
    ctx.body = {
      name,
      success: false,
      connected: false,
      tool_count: 0,
      tools: [],
      error: String(err),
    }
  }
}

/**
 * Test an HTTP MCP server by connecting and listing tools
 */
async function testHttpMCPServer(
  url: string,
  headers?: Record<string, string>,
  timeoutSeconds: number = 30
): Promise<MCPServerTestResult> {
  return new Promise((resolve, reject) => {
    // MCP HTTP transport with SSE streaming response
    const postData = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "hermes-web-ui-test", version: "1.0" }
      }
    })
    
    const urlObj = new URL(url)
    const options: http.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(postData),
        ...headers,
      },
      timeout: timeoutSeconds * 1000,
    }
    
    const client = urlObj.protocol === 'https:' ? https : http
    const req = client.request(options, (res: http.IncomingMessage) => {
      const sessionId = res.headers['mcp-session-id']
      let sseBuffer = ''
      let toolsParsed = false
      const tools: MCPToolInfo[] = []
      let serverName = ''
      let serverVersion = ''
      
      // Parse SSE data lines
      const parseSSELine = (line: string): string | null => {
        if (line.startsWith('data: ')) {
          return line.slice(6)
        }
        return null
      }
      
      // Try to extract tools from response data
      const extractToolsFromSSE = (data: string): void => {
        const trimmed = data.trim()
        
        // Handle pure JSON response (not SSE format)
        if (trimmed.startsWith('{')) {
          try {
            const parsed = JSON.parse(trimmed)
            processResponse(parsed)
          } catch {
            logger.error(`Failed to parse JSON: ${trimmed.substring(0, 100)}`)
          }
          return
        }
        
        // Handle SSE format (data: ...)
        const lines = trimmed.split('\n')
        for (const line of lines) {
          const jsonStr = parseSSELine(line)
          if (jsonStr) {
            const lineTrimmed = jsonStr.trim()
            try {
              if (lineTrimmed.startsWith('[')) {
                // Array of responses
                const parsed = JSON.parse(lineTrimmed)
                for (const item of parsed) {
                  processResponse(item)
                }
              } else {
                // Single response
                const parsed = JSON.parse(lineTrimmed)
                processResponse(parsed)
              }
            } catch {
              // Try line by line parsing for concatenated JSON
              const parts = lineTrimmed.split(/\}\n\{/)
              for (let i = 0; i < parts.length; i++) {
                let part = parts[i]
                if (i > 0) part = '{' + part
                if (i < parts.length - 1) part = part + '}'
                try {
                  const parsed = JSON.parse(part)
                  processResponse(parsed)
                } catch {
                  // Not valid JSON, skip
                }
              }
            }
          }
        }
      }
      
      const processResponse = (parsed: any): void => {
        // Get server info from initialize response
        if (parsed.result?.serverInfo) {
          serverName = parsed.result.serverInfo.name || ''
          serverVersion = parsed.result.serverInfo.version || ''
        }
        // Get tools from tools/list response
        if (parsed.result?.tools && Array.isArray(parsed.result.tools)) {
          toolsParsed = true
          for (const tool of parsed.result.tools) {
            tools.push({
              name: tool.name || '',
              description: tool.description || '',
            })
          }
        }
      }
      
      res.on('data', (chunk: Buffer) => {
        sseBuffer += chunk.toString()
      })
      
      res.on('end', () => {
        // Parse the initialize response first
        extractToolsFromSSE(sseBuffer)
        
        if (sessionId && serverName) {
          // Send initialized notification (ignore response for notification)
          const initializedData = JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
            params: {}
          })
          
          const req2 = client.request({
            ...options,
            headers: {
              ...options.headers,
              'mcp-session-id': sessionId as string,
              'Content-Length': Buffer.byteLength(initializedData),
            }
          }, (res2: http.IncomingMessage) => {
            let initResponse = ''
            res2.on('data', (chunk: Buffer) => { initResponse += chunk.toString() })
            res2.on('end', () => {
              // Now send tools/list request
              const toolsRequest = JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                method: "tools/list",
                params: {}
              })
              
              const req3 = client.request({
                ...options,
                headers: {
                  ...options.headers,
                  'mcp-session-id': sessionId as string,
                  'Content-Length': Buffer.byteLength(toolsRequest),
                }
              }, (res3: http.IncomingMessage) => {
                let toolsResponse = ''
                res3.on('data', (chunk: Buffer) => { toolsResponse += chunk.toString() })
                res3.on('end', () => {
                  extractToolsFromSSE(toolsResponse)
                  
                  if (tools.length > 0) {
                    resolve({
                      name: serverName || '',
                      success: true,
                      connected: true,
                      tool_count: tools.length,
                      tools,
                      message: `Connected to ${serverName} ${serverVersion}, found ${tools.length} tools`,
                    })
                  } else {
                    resolve({
                      name: serverName || '',
                      success: true,
                      connected: true,
                      tool_count: 0,
                      tools: [],
                      message: `Connected to ${serverName} ${serverVersion}, but no tools found in response`,
                    })
                  }
                })
              })
              req3.on('error', reject)
              req3.write(toolsRequest)
              req3.end()
            })
          })
          req2.on('error', reject)
          req2.write(initializedData)
          req2.end()
        } else {
          // No session support, just report what we got
          if (tools.length > 0) {
            resolve({
              name: serverName || '',
              success: true,
              connected: true,
              tool_count: tools.length,
              tools,
              message: `Found ${tools.length} tools`,
            })
          } else if (serverName) {
            resolve({
              name: serverName,
              success: true,
              connected: true,
              tool_count: 0,
              tools: [],
              message: `Connected to ${serverName} ${serverVersion}`,
            })
          } else {
            reject(new Error('Invalid MCP response or server does not support this protocol'))
          }
        }
      })
    })
    
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`Connection timeout after ${timeoutSeconds}s`))
    })
    
    req.write(postData)
    req.end()
  })
}

/**
 * Extract tools from MCP tools/list response
 */
function extractToolsFromResult(result: any): MCPToolInfo[] {
  if (!result) return []
  
  // result could be array or single object
  const toolsArray = Array.isArray(result) ? result : [result]
  const tools: MCPToolInfo[] = []
  
  for (const item of toolsArray) {
    if (item?.result?.tools && Array.isArray(item.result.tools)) {
      for (const tool of item.result.tools) {
        tools.push({
          name: tool.name || '',
          description: tool.description || '',
        })
      }
    }
  }
  
  return tools
}

export async function getTools(ctx: Context): Promise<void> {
  const { name } = ctx.params
  
  const servers = await readMCPServers()
  
  if (!servers[name]) {
    ctx.status = 404
    ctx.body = { detail: `MCP server '${name}' not found` }
    return
  }
  
  // Return placeholder - actual tools would come from MCP runtime
  const response: MCPServerToolsResponse = {
    name,
    tools: [],
    total: 0,
  }
  
  ctx.body = response
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