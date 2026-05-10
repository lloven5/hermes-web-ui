import Router from '@koa/router'
import * as ctrl from '../../controllers/hermes/mcp'

export const mcpRoutes = new Router()

// GET /api/hermes/mcp/servers - List all MCP servers
mcpRoutes.get('/api/hermes/mcp/servers', ctrl.list)

// GET /api/hermes/mcp/servers/:name - Get single MCP server
mcpRoutes.get('/api/hermes/mcp/servers/:name', ctrl.get)

// POST /api/hermes/mcp/servers/:name - Create MCP server
mcpRoutes.post('/api/hermes/mcp/servers/:name', ctrl.create)

// PUT /api/hermes/mcp/servers/:name - Update MCP server
mcpRoutes.put('/api/hermes/mcp/servers/:name', ctrl.update)

// DELETE /api/hermes/mcp/servers/:name - Delete MCP server
mcpRoutes.delete('/api/hermes/mcp/servers/:name', ctrl.remove)

// POST /api/hermes/mcp/servers/:name/test - Test MCP server connection
mcpRoutes.post('/api/hermes/mcp/servers/:name/test', ctrl.test)

// GET /api/hermes/mcp/servers/:name/tools - Get MCP server tools
mcpRoutes.get('/api/hermes/mcp/servers/:name/tools', ctrl.getTools)

// POST /api/hermes/mcp/reload - Reload MCP servers
mcpRoutes.post('/api/hermes/mcp/reload', ctrl.reload)

// GET /api/hermes/mcp/status - Get MCP status
mcpRoutes.get('/api/hermes/mcp/status', ctrl.status)

// GET /api/hermes/mcp/tools - List all MCP tools
mcpRoutes.get('/api/hermes/mcp/tools', ctrl.listAllTools)