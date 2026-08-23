/** Xterm-based user terminal drawer with project Actions and live process facts. */

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ProjectTerminalSnapshot } from '../types.js'
import type {
  FooterActionRuntime,
  ProjectTerminalInjected,
  Translate,
} from './contracts.js'
import css from './ProjectTerminalPanel.module.css'

export type ProjectTerminalPanelProps = FooterActionRuntime & ProjectTerminalInjected & { readonly t: Translate }

function TerminalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect x="2.2" y="3" width="13.6" height="11.6" rx="2.1" stroke="currentColor" strokeWidth="1.35" />
      <path d="m5.1 6.4 2.3 2.1-2.3 2.1M9 11h3.6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CloseIcon() {
  return <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden><path d="m4.3 4.3 8.4 8.4m0-8.4-8.4 8.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
}

function RefreshIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M12.7 5.2A5 5 0 1 0 13 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M10.4 2.8h2.8v2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

function actionGlyph(kind: string): string {
  if (kind === 'run' || kind === 'dev') return '▶'
  if (kind === 'test') return '✓'
  if (kind === 'lint') return '⌁'
  if (kind === 'build') return '◆'
  return '›_'
}

/** Render the root-scoped trigger and Session-aware terminal drawer. */
export function ProjectTerminalPanel({ wide, api, sessionList, t }: ProjectTerminalPanelProps) {
  const list = useSyncExternalStore(sessionList.subscribe.bind(sessionList), sessionList.getSnapshot.bind(sessionList), sessionList.getSnapshot.bind(sessionList))
  const sessionId = list.current
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<ProjectTerminalSnapshot>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [terminalGeneration, setTerminalGeneration] = useState(0)
  const terminalHost = useRef<HTMLDivElement>(null)
  const terminalInstance = useRef<Terminal>()
  const trigger = useRef<HTMLButtonElement>(null)
  const identity = useId().replaceAll(':', '')
  const panelId = `dsh-project-terminal-${identity}`

  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.metaKey || event.altKey || event.key !== '`') return
      event.preventDefault()
      setOpen(value => !value)
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key) }
  }, [])

  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key) }
  }, [open])

  useLayoutEffect(() => {
    setSnapshot(undefined)
    setError(undefined)
  }, [sessionId])

  useLayoutEffect(() => {
    if (!open || sessionId === undefined || terminalHost.current === null) return
    const controller = new AbortController()
    let timer: number | undefined
    let cursor = 0
    let stopped = false
    let pollFailed = false
    let writes = Promise.resolve()
    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: '"SFMono-Regular", "Cascadia Code", "Liberation Mono", monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: {
        background: '#101417',
        foreground: '#d8e2df',
        cursor: '#74f2bd',
        selectionBackground: '#38554a99',
        black: '#101417',
        brightBlack: '#66716f',
        green: '#74f2bd',
        brightGreen: '#a4ffd7',
        cyan: '#72d6e8',
        yellow: '#e6c875',
        red: '#ff7f79',
      },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(terminalHost.current)
    fit.fit()
    terminal.focus()
    terminalInstance.current = terminal
    const input = terminal.onData((data) => {
      writes = writes.then(() => api.write(sessionId, data)).catch((cause: unknown) => {
        if (!stopped) setError(cause instanceof Error ? cause.message : String(cause))
      })
    })
    const resize = new ResizeObserver(() => { try { fit.fit() } catch { /* disposed between observer delivery and cleanup */ } })
    resize.observe(terminalHost.current)

    const poll = async (): Promise<void> => {
      if (stopped) return
      try {
        const next = await api.read(sessionId, cursor, controller.signal)
        if (pollFailed) setError(undefined)
        pollFailed = false
        cursor = next.cursor
        if (next.truncated) terminal.reset()
        if (next.output.length > 0) terminal.write(next.output)
        setSnapshot(current => current === undefined ? current : {
          ...current,
          terminal: {
            cursor: next.cursor,
            process: next.process,
            ...next.action === undefined ? {} : { action: next.action },
            ports: next.ports,
          },
          setup: next.action?.kind === 'setup'
            ? {
                ...current.setup,
                status: next.action.status === 'running' ? 'running' : next.action.status,
                ...next.action.exitCode === undefined ? {} : { lastExitCode: next.action.exitCode },
              }
            : current.setup,
        })
        timer = window.setTimeout(() => { void poll() }, 260)
      } catch (cause) {
        if (!controller.signal.aborted) {
          pollFailed = true
          setError(cause instanceof Error ? cause.message : String(cause))
          timer = window.setTimeout(() => { void poll() }, 1000)
        }
      }
    }

    setLoading(true)
    setError(undefined)
    void api.open(sessionId, Math.max(10, terminal.rows), Math.max(40, terminal.cols), controller.signal).then((initial) => {
      if (stopped) return
      setSnapshot(initial)
      cursor = initial.terminal?.cursor ?? 0
      if (initial.output.length > 0) terminal.write(initial.output)
      setLoading(false)
      void poll()
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setLoading(false)
      }
    })
    return () => {
      stopped = true
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
      resize.disconnect()
      input.dispose()
      terminal.dispose()
      terminalInstance.current = undefined
    }
  }, [api, open, sessionId, terminalGeneration])

  const perform = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  const active = snapshot?.terminal?.action?.status === 'running'
  const activeActionId = active ? snapshot.terminal?.action?.actionId : undefined
  const processStatus = snapshot?.terminal?.process.status

  return (
    <div className={wide ? css.root : `${css.root} ${css.rail}`}>
      <button
        ref={trigger}
        type="button"
        className={open ? `${css.trigger} ${css.triggerOpen}` : css.trigger}
        aria-label={t('trigger.title')}
        aria-expanded={open}
        aria-controls={panelId}
        title={wide ? undefined : t('trigger.label')}
        onClick={() => { setOpen(value => !value) }}
      >
        <TerminalIcon />
        {wide && <><span>{t('trigger.label')}</span><kbd>⌃`</kbd></>}
        {snapshot?.terminal?.action?.status === 'running' && <span className={css.liveDot} />}
      </button>

      {open && <section id={panelId} className={css.panel} role="dialog" aria-modal="true" aria-label={t('panel.title')}>
        <header className={css.header}>
          <div className={css.identity}>
            <span className={css.terminalMark}><TerminalIcon /></span>
            <div>
              <div className={css.titleLine}>
                <h2>{snapshot?.projectName ?? t('panel.title')}</h2>
                {snapshot !== undefined && <span className={css.checkout}>{t(`checkout.${snapshot.checkout}`)}</span>}
              </div>
              <p>{snapshot?.cwd ?? (sessionId ?? t('empty.body'))}</p>
            </div>
          </div>
          <div className={css.headerActions}>
            <span className={css.readOnlyBadge}><i />{t('terminal.agentReadOnly')}</span>
            {sessionId !== undefined && <button type="button" className={css.iconButton} aria-label={t('panel.refresh')} onClick={() => {
              void perform(async () => { setSnapshot(await api.refresh(sessionId)) })
            }}><RefreshIcon /></button>}
            <button type="button" className={css.iconButton} aria-label={t('panel.close')} onClick={() => { setOpen(false); trigger.current?.focus() }}><CloseIcon /></button>
          </div>
        </header>

        {sessionId === undefined
          ? <div className={css.empty}><span><TerminalIcon /></span><h3>{t('empty.title')}</h3><p>{t('empty.body')}</p></div>
          : <div className={css.body}>
              <aside className={css.railPanel}>
                <section>
                  <div className={css.sectionHead}><h3>{t('actions.title')}</h3><span>{snapshot?.actions.length ?? 0}</span></div>
                  <div className={css.actionGrid}>
                    {snapshot?.actions.map(action => <button
                      key={action.id}
                      type="button"
                      disabled={busy || active}
                      data-kind={action.kind}
                      data-active={activeActionId === action.id}
                      aria-busy={activeActionId === action.id}
                      title={action.command}
                      onClick={() => { void perform(() => api.runAction(sessionId, action.id)) }}
                    ><b>{actionGlyph(action.kind)}</b><span>{action.label}</span></button>)}
                    {snapshot !== undefined && snapshot.actions.length === 0 && <p className={css.muted}>{t('actions.empty')}</p>}
                  </div>
                </section>

                <section className={css.setupCard} data-state={snapshot?.setup.status ?? 'not-configured'}>
                  <div className={css.sectionHead}><h3>{t('setup.title')}</h3><span className={css.statusDot} /></div>
                  <p>{t(`setup.${snapshot?.setup.status ?? 'not-configured'}`)}</p>
                  {snapshot?.setup.configured === true && snapshot.setup.status !== 'running' && <button type="button" disabled={busy || active} onClick={() => { void perform(() => api.runSetup(sessionId)) }}>{t('actions.setup')}</button>}
                </section>

                <section>
                  <div className={css.sectionHead}><h3>{t('process.title')}</h3><span className={snapshot?.terminal?.process.status === 'running' ? css.processLive : css.processOff} /></div>
                  <dl className={css.processList}>
                    <div><dt>{t('process.shell')}</dt><dd>{snapshot?.terminal?.process.pid ?? '—'}</dd></div>
                    <div><dt>{t('process.foreground')}</dt><dd>{snapshot?.terminal?.process.foreground?.processGroupId ?? '—'}</dd></div>
                    <div><dt>{t('process.state')}</dt><dd>{snapshot?.terminal?.action === undefined
                      ? t(snapshot?.terminal?.process.foreground?.inputWaiting === true ? 'process.waiting' : `process.${processStatus ?? 'running'}`)
                      : `${snapshot.terminal.action.label} · ${t(`actions.${snapshot.terminal.action.status}`)}`}</dd></div>
                  </dl>
                  <div className={css.processActions}>
                    <button type="button" disabled={busy || snapshot?.terminal === undefined} onClick={() => { void perform(() => api.interrupt(sessionId)) }}>{t('actions.interrupt')}</button>
                    <button type="button" disabled={busy || snapshot?.terminal === undefined} onClick={() => {
                      if (!window.confirm(t('actions.confirmStop'))) return
                      void perform(async () => {
                        await api.close(sessionId)
                        terminalInstance.current?.reset()
                        setSnapshot(undefined)
                        setOpen(false)
                      })
                    }}>{t('actions.stop')}</button>
                  </div>
                </section>

                <section>
                  <div className={css.sectionHead}><h3>{t('ports.title')}</h3><span>{snapshot?.terminal?.ports.filter(port => port.listening).length ?? 0}</span></div>
                  <div className={css.ports}>
                    {snapshot?.terminal?.ports.map(port => <a key={port.port} href={port.url} target="_blank" rel="noreferrer" data-live={port.listening}>
                      <span>:{port.port}</span><small>{t(port.listening ? 'ports.listening' : 'ports.closed')}</small>
                    </a>)}
                    {(snapshot?.terminal?.ports.length ?? 0) === 0 && <p className={css.muted}>{t('ports.empty')}</p>}
                  </div>
                </section>
              </aside>

              <main className={css.terminalPane}>
                {loading && <div className={css.loading}>{t('loading')}</div>}
                {error !== undefined && <div className={css.error} role="alert"><strong>{t('error.title')}</strong><span>{error}</span></div>}
                <div ref={terminalHost} className={css.xtermHost} />
                <footer data-state={processStatus ?? 'connecting'} aria-live="polite">
                  <span>{processStatus === 'exited' ? t('process.exited') : t(processStatus === 'running' ? 'process.running' : 'loading')}</span>
                  {processStatus === 'exited'
                    ? <button type="button" onClick={() => { setTerminalGeneration(value => value + 1) }}>{t('actions.restart')}</button>
                    : <kbd>{t('terminal.shortcut')}</kbd>}
                </footer>
              </main>
            </div>}
      </section>}
    </div>
  )
}
