import { request } from '../client'

export interface MCPServerConfig {
  name: string
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  transport: 'http' | 'stdio'
  auth?: string
  enabled: boolean
  tools?: string[]
  timeout: number
  connected: boolean
  tool_count: number
}

export interface MCPServerListResponse {
  servers: MCPServerConfig[]
  total: number
}

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
  servers: MCPServerConfig[]
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

// GET /api/hermes/mcp/servers
export async function fetchMCPServers(): Promise<MCPServerListResponse> {
  return request<MCPServerListResponse>('/api/hermes/mcp/servers')
}

// GET /api/hermes/mcp/servers/{name}
export async function fetchMCPServer(name: string): Promise<MCPServerConfig> {
  return request<MCPServerConfig>(`/api/hermes/mcp/servers/${encodeURIComponent(name)}`)
}

// POST /api/hermes/mcp/servers/{name}
export async function createMCPServer(name: string, config: MCPServerCreateRequest): Promise<MCPServerConfig> {
  return request<MCPServerConfig>(`/api/hermes/mcp/servers/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: JSON.stringify(config),
  })
}

// PUT /api/hermes/mcp/servers/{name}
export async function updateMCPServer(name: string, config: MCPServerUpdateRequest): Promise<MCPServerConfig> {
  return request<MCPServerConfig>(`/api/hermes/mcp/servers/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(config),
  })
}

// DELETE /api/hermes/mcp/servers/{name}
export async function deleteMCPServer(name: string): Promise<void> {
  await request(`/api/hermes/mcp/servers/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}

// POST /api/hermes/mcp/servers/{name}/test
export async function testMCPServer(name: string, timeout?: number): Promise<MCPServerTestResult> {
  const url = `/api/hermes/mcp/servers/${encodeURIComponent(name)}/test`
  return request<MCPServerTestResult>(timeout ? `${url}?timeout=${timeout}` : url, {
    method: 'POST',
  })
}

// GET /api/hermes/mcp/servers/{name}/tools
export async function fetchMCPServerTools(name: string): Promise<MCPServerToolsResponse> {
  return request<MCPServerToolsResponse>(`/api/hermes/mcp/servers/${encodeURIComponent(name)}/tools`)
}

// POST /api/hermes/mcp/reload
export async function reloadMCPServers(): Promise<MCPReloadResult> {
  return request<MCPReloadResult>('/api/hermes/mcp/reload', {
    method: 'POST',
  })
}

// GET /api/hermes/mcp/status
export async function fetchMCPStatus(): Promise<MCPStatusResponse> {
  return request<MCPStatusResponse>('/api/hermes/mcp/status')
}

// GET /api/hermes/mcp/tools
export async function fetchAllMCPTools(): Promise<MCCAllToolsResponse> {
  return request<MCCAllToolsResponse>('/api/hermes/mcp/tools')
}

// POST /api/hermes/mcp/servers/{name}/connect
export async function connectMCPServer(name: string, timeout?: number): Promise<MCPServerTestResult> {
  const url = `/api/hermes/mcp/servers/${encodeURIComponent(name)}/connect`
  return request<MCPServerTestResult>(timeout ? `${url}?timeout=${timeout}` : url, {
    method: 'POST',
  })
}

// POST /api/hermes/mcp/servers/{name}/disconnect
export async function disconnectMCPServer(name: string): Promise<MCPServerTestResult> {
  return request<MCPServerTestResult>(`/api/hermes/mcp/servers/${encodeURIComponent(name)}/disconnect`, {
    method: 'POST',
  })
}

// GET /api/hermes/mcp/servers/{name}/status
export async function getMCPServerStatus(name: string): Promise<MCPServerTestResult> {
  return request<MCPServerTestResult>(`/api/hermes/mcp/servers/${encodeURIComponent(name)}/status`)
}