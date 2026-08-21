# Architecture

The plugin has four deliberately separate paths.

1. `ProjectTerminalService` resolves an exact Session id to its live or persisted header cwd. Browser payloads never supply the directory used for process creation.
2. `HumanTerminal` allocates a PTY through `ctx.subprocess.spawnTerminal()`, retains bounded output, tracks one user-started Action, and owns complete process-tree cleanup. It does not enter DSH's Agent-owned `ctx.terminals` registry.
3. `/project-terminal` is registered with `authority: loopback`. The browser can open, type, run an Action or setup, interrupt, and close. Each endpoint re-resolves Session authority before accessing a terminal.
4. `project_terminal_read` maps the initiating Agent's exact Session id to the human registry and returns recent output. No write, Action, signal, or close model tool is registered.

The browser client is a self-contained ModuleLoader bundle. It contributes one `sidebar.footer.action` entry and renders a fixed terminal drawer. xterm and its fit addon are bundled into the plugin; React remains supplied by DSH.

## Project Actions and setup

`.dsh/environment.json` is read inside the authoritative checkout. Platform-specific commands are selected on the Host. In the absence of explicit Actions, the loader derives conventional commands from `package.json` and the checkout lockfile.

Linked worktrees are detected read-only from a file-valued `<cwd>/.git`. Automatic setup requires an explicit `autoRunOnWorktree: true`. A successful setup command digest is written atomically under the DSH home; changing either platform or command produces a new digest and makes setup pending again.

Actions are written to the same human shell. A private OSC marker records completion and exit status without printing a control row in xterm. Long-lived development servers keep the Action running, while URLs in output seed loopback port probes.

## Lifecycle

Terminals survive drawer close and Session navigation. The configured terminal limit fails loudly instead of deleting user processes. The user may explicitly stop a terminal, and Host plugin disposal awaits termination of every retained PTY session.
