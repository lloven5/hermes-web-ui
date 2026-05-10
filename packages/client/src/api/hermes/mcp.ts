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

// GET /api/mcp/servers
export async function fetchMCPServers(): Promise<MCPServerListResponse> {
  return request<MCPServerListResponse>('/api/mcp/servers')
}

// GET /api/mcp/servers/{name}
export async function fetchMCPServer(name: string): Promise<MCPServerConfig> {
  return request<MCPServerConfig>(`/api/mcp/servers/${encodeURIComponent(name)}`)
}

// POST /api/mcp/servers/{name}
export async function createMCPServer(name: string, config: MCPServerCreateRequest): Promise<MCPServerConfig> {
  return request<MCPServerConfig>(`/api/mcp/servers/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: JSON.stringify(config),
  })
}

// PUT /api/mcp/servers/{name}
export async function updateMCPServer(name: string, config: MCPServerUpdateRequest): Promise<MCPServerConfig> {
  return request<MCPServerConfig>(`/api/mcp/servers/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(config),
  })
}

// DELETE /api/mcp/servers/{name}
export async function deleteMCPServer(name: string): Promise<void> {
  await request(`/api/mcp/servers/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}

// POST /api/mcp/servers/{name}/test
export async function testMCPServer(name: string, timeout?: number): Promise<MCPServerTestResult> {
  const url = `/api/mcp/servers/${encodeURIComponent(name)}/test`
  return request<MCPServerTestResult>(timeout ? `${url}?timeout=${timeout}` : url, {
    method: 'POST',
  })
}

// GET /api/mcp/servers/{name}/tools
export async function fetchMCPServerTools(name: string): Promise<MCPServerToolsResponse> {
  return request<MCPServerToolsResponse>(`/api/mcp/servers/${encodeURIComponent(name)}/tools`)
}

// POST /api/mcp/reload
export async function reloadMCPServers(): Promise<MCPReloadResult> {
  return request<MCPReloadResult>('/api/mcp/reload', {
    method: 'POST',
  })
}

// GET /api/mcp/status
export async function fetchMCPStatus(): Promise<MCPStatusResponse> {
  return request<MCPStatusResponse>('/api/mcp/status')
}

// GET /api/mcp/tools
export async function fetchAllMCPTools(): Promise<MCCAllToolsResponse> {
  return request<MCCAllToolsResponse>('/api/mcp/tools')
}