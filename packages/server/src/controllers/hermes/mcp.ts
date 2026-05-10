import type { Context } from 'koa'
import YAML from 'js-yaml'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { getActiveConfigPath } from '../../services/hermes/hermes-profile'
import { logger } from '../../services/logger'

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

/** Convert config to response with computed fields */
function configToResponse(name: string, config: MCPServerConfig): MCPServerWithStatus {
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
    connected: false, // Will be updated when we can actually test connections
    tool_count: 0, // Will be updated when we can actually test connections
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
  const { name } = ctx.params
  const body = ctx.request.body as MCPServerCreateRequest
  
  // Validate name
  if (!name || !name.trim()) {
    ctx.status = 400
    ctx.body = { detail: "Server name cannot be empty" }
    return
  }
  if (!name.replace(/-/g, '').replace(/_/g, '').isAlphanumeric()) {
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
  
  ctx.status = 201
  ctx.body = configToResponse(name, serverConfig)
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
  
  // For now, just return a placeholder result
  // Full implementation would actually test the MCP server connection
  const result: MCPServerTestResult = {
    name,
    success: true,
    connected: true,
    tool_count: 0,
    tools: [],
    message: "Connection test placeholder - actual testing requires MCP runtime",
  }
  
  ctx.body = result
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