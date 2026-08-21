/** The only model-facing capability: bounded read access to the human terminal. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ProjectTerminalService } from './service.js'

function requireAgent(agent: Agent | undefined): Agent {
  if (agent === undefined) throw new Error('project_terminal_read requires an initiating Agent')
  return agent
}

/** Register a read-only terminal tool; no model write or Action tool exists. */
export function registerProjectTerminalReadTool(ctx: Context, service: ProjectTerminalService, maximumLines: number): void {
  ctx.tools.register(defineTool({
    name: 'project_terminal_read',
    description: 'Read the current Session\'s user-operated project terminal output and process status. This tool is read-only: it cannot type, run Actions, interrupt, or close the terminal.',
    parameters: {
      lines: { type: 'integer', description: `Number of recent lines to return (10-${String(maximumLines)}; default ${String(maximumLines)}).` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          available: { type: 'boolean', required: true },
          cwd: { type: 'string' },
          pid: { type: 'integer' },
          status: { type: 'string', enum: ['running', 'exited'] },
          action: { type: 'string' },
          ports: { type: 'array', required: true, items: { type: 'integer' } },
          output: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.output }],
    },
    async execute(args: { lines?: number }, exec) {
      const lines = args.lines ?? maximumLines
      if (!Number.isSafeInteger(lines) || lines < 10 || lines > maximumLines) {
        throw new Error(`lines must be an integer from 10 to ${String(maximumLines)}`)
      }
      return await service.readForAgent(requireAgent(exec.agent), lines)
    },
    presentCall: () => ({ card: 'generic', title: 'Read human terminal', kind: 'read' }),
  }))
}
