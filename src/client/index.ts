/** Register Project Terminal in DSH's additive sidebar footer-action slot. */

import { mountCss as mountXtermCss } from '@xterm/xterm/css/xterm.css'
import { ConnectionProjectTerminalApi } from './api.js'
import type { ProjectTerminalClientContext, ProjectTerminalInjected } from './contracts.js'
import { en, NS, zh } from './locales.js'
import { ProjectTerminalPanel } from './ProjectTerminalPanel.js'
import { mountCss } from './ProjectTerminalPanel.module.css'

export { ConnectionProjectTerminalApi } from './api.js'
export { ProjectTerminalPanel } from './ProjectTerminalPanel.js'
export type * from './contracts.js'

/** Cordis browser plugin name. */
export const name = 'project-terminal'

/** Browser services required for Session selection, RPC, locale, and the additive footer slot. */
export const inject = ['slots', 'sessions', 'connection', 'locale']

/** Register styles, dictionaries, and the terminal trigger. */
export function apply(ctx: ProjectTerminalClientContext): void {
  const api = new ConnectionProjectTerminalApi(ctx.get('connection').rpc)
  ctx.effect(() => mountCss(), 'dsh-project-terminal: styles')
  ctx.effect(() => mountXtermCss(), 'dsh-project-terminal: xterm styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-project-terminal: dictionaries')
  ctx.effect(() => ctx.slots.inject(
    'sidebar.footer.action',
    () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'project-terminal',
      order: 30,
      label: () => ctx.locale.bind(NS)('trigger.label'),
      locale: NS,
      inject: (): ProjectTerminalInjected => ({ api, sessionList: ctx.sessions.list }),
    }, ProjectTerminalPanel),
  ), 'dsh-project-terminal: footer action')
}
