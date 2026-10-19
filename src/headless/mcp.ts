import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS, callTool, type ToolContext } from './tools';

/** MCP server over stdio: an AI client (Claude Desktop, Claude Code, or a local model through any MCP
 * client) starts `lvds mcp` and calls the tools. Runs on this computer only; project files never
 * leave it except as the short results the client asks for. Stage 1: every tool is read only. */
export function createMcp(ctx: ToolContext, version: string): McpServer {
  const server = new McpServer(
    { name: 'lv-design-studio', title: 'LV Design Studio', version },
    { instructions: 'Read and check LV Design Studio projects (low-voltage electrical design). Start with list_projects, then project_summary or run_checks. Tools never change a project. Results are a design aid: a qualified engineer checks them.' }
  );
  for (const t of TOOLS) {
    server.registerTool(t.name, {
      title: t.title,
      description: t.description,
      inputSchema: t.input,
      annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async (args: Record<string, unknown>) => {
      try {
        return { content: [{ type: 'text' as const, text: JSON.stringify(callTool(t, args, ctx)) }] };
      } catch (e) {
        return { isError: true, content: [{ type: 'text' as const, text: (e as Error).message }] };
      }
    });
  }
  return server;
}

export async function startMcp(ctx: ToolContext, version: string): Promise<void> {
  await createMcp(ctx, version).connect(new StdioServerTransport());
}
