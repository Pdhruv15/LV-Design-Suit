import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { callTool, offeredTools, type ToolContext } from './tools';

/** MCP server over stdio: an AI client (Claude Desktop, Claude Code, or a local model through any MCP
 * client) starts `lvds mcp` and calls the tools. Runs on this computer only; project files never
 * leave it except as the short results the client asks for. Read-only tools always; tools that change a project only
 * when started with --write (and even then they preview unless called with mode apply / propose). */
const READ_INSTRUCTIONS = 'Read and check LV Design Studio projects (low-voltage electrical design). Start with list_projects, then project_summary or run_checks. These tools never change a project. Results are a design aid: a qualified engineer checks them.';
const WRITE_INSTRUCTIONS = `${READ_INSTRUCTIONS.replace(' These tools never change a project.', '')} Tools that change a project preview by default: show the preview to the engineer and only call again with mode apply / propose when they agree. Value changes (cable, breaker, load, settings) are proposals in Reports → Changes: the engineer accepts and applies them in the app. Use size_circuits to size, propose_changes for other values; add_panel, add_circuit, move_panel, rename_panels and copy_panel change the structure (undo_change puts a change back).`;

export function createMcp(ctx: ToolContext, version: string): McpServer {
  const server = new McpServer(
    { name: 'lv-design-studio', title: 'LV Design Studio', version },
    { instructions: ctx.write ? WRITE_INSTRUCTIONS : READ_INSTRUCTIONS }
  );
  for (const t of offeredTools(ctx)) {
    server.registerTool(t.name, {
      title: t.title,
      description: t.description,
      inputSchema: t.input,
      annotations: t.writes
        ? { title: t.title, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
        : { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async (args: Record<string, unknown>) => {
      try {
        return { content: [{ type: 'text' as const, text: JSON.stringify(await callTool(t, args, ctx)) }] };
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
