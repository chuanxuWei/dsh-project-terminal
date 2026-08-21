# DSH Project Terminal

[中文说明](README.zh.md)

> A Session-scoped terminal for humans, with project Actions, worktree setup, and live development status inside DeepSeek Harness Web.

`dsh-project-terminal` keeps the terminal a user-operated surface while still letting the current Agent understand what happened. Each terminal is bound to the authoritative checkout of one DSH Session. The browser user can type, run Actions, interrupt, and stop processes; the Agent receives only the bounded, read-only `project_terminal_read` tool.

## Why

After an Agent changes a project, users should be able to rerun tests, inspect output, or start a development server without leaving DSH. That human workflow should not silently become another model-controlled shell.

This plugin separates the two paths:

| Capability | Browser user | Agent |
| --- | :---: | :---: |
| Read terminal output and status | Yes | Yes, bounded |
| Type into the terminal | Yes | No |
| Run project Actions or setup | Yes | No |
| Interrupt or stop processes | Yes | No |

## Features

- One retained xterm terminal per current Session and checkout.
- Automatic discovery of `Run`, `Test`, `Lint`, `Dev`, and `Build` scripts from `package.json`.
- Explicit project Actions and platform-specific setup through `.dsh/environment.json`.
- Opt-in automatic setup when DSH creates a Session for a linked Git worktree.
- Live Shell PID, foreground process group, Action result, and loopback-probed development ports.
- <kbd>Ctrl</kbd> + <kbd>&#96;</kbd> shortcut and a terminal drawer mounted through DSH's supported `sidebar.footer.action` slot.
- Host-authoritative cwd resolution: browser requests cannot substitute another checkout path.
- Bounded output retention and a read-only Agent tool with no matching write or Action tool.

## Quick start

Requirements: Node.js `22.19+`, pnpm `11.19+`, and DeepSeek Harness `0.1.0-rc.8`.

```sh
git clone https://github.com/chuanxuWei/dsh-project-terminal.git
cd dsh-project-terminal
pnpm install --frozen-lockfile
pnpm check
pnpm dlx @deepseek-ai/dsh@0.1.0-rc.8 plugin --profile web add .
pnpm dlx @deepseek-ai/dsh@0.1.0-rc.8 web
```

Open a project Session, then select **Terminal** in the sidebar footer or press <kbd>Ctrl</kbd> + <kbd>&#96;</kbd>. Without project configuration, conventional `package.json` scripts appear automatically as Actions.

## Project configuration

Add `.dsh/environment.json` to a project when it needs setup or custom Actions:

```json
{
  "version": 1,
  "setup": {
    "command": "pnpm install --frozen-lockfile",
    "darwin": "pnpm install --frozen-lockfile && pnpm build",
    "win32": "pnpm install --frozen-lockfile; pnpm build",
    "autoRunOnWorktree": true
  },
  "actions": [
    { "id": "run", "label": "Run", "kind": "run", "command": "pnpm start" },
    { "id": "test", "label": "Test", "kind": "test", "command": "pnpm test" },
    { "id": "lint", "label": "Lint", "kind": "lint", "command": "pnpm lint" },
    { "id": "dev", "label": "Dev", "kind": "dev", "command": "pnpm dev" }
  ]
}
```

`darwin`, `linux`, or `win32` overrides the fallback `command` for that platform.

Automatic setup runs only when all three conditions hold:

1. The Session cwd is a linked Git worktree.
2. The repository explicitly sets `autoRunOnWorktree: true`.
3. The exact setup command digest has not already succeeded for that checkout.

Successful setup digests are stored atomically under the active DSH home. Changing the platform-specific command makes setup pending again.

## Security model

The plugin does not reuse the Agent-owned `ctx.terminals` registry. It allocates separate human PTYs through `ctx.subprocess.spawnTerminal()` and exposes browser mutations only through a `loopback` Connection route. Every operation resolves the cwd again from the live or persisted Session header.

The Agent-facing surface contains only `project_terminal_read`. It resolves the initiating Agent's exact Session id and returns a bounded tail plus process and port status. No model tool is registered for terminal input, Actions, setup, signals, or shutdown.

Commands still run with the DSH Host user's operating-system permissions. This is an authorization boundary between the user interface and Agent tools, not an OS sandbox. Review repository configuration before enabling automatic setup.

## Validation

Version `0.1.0` was validated against DSH `0.1.0-rc.8` with:

- frozen dependency installation, TypeScript build, package authority checks, and `pnpm pack --dry-run`;
- 6 Vitest files and 10 tests, including linked-worktree setup and exact-Session Agent reads;
- installation into an isolated DSH Web profile and composed-config inspection;
- real Host listener/HTTP checks and browser interaction;
- terminal input, a passing Test Action, live port discovery, interrupt handling, and zero browser errors.

See [architecture](docs/architecture.md), [manual verification](docs/manual-verification.md), and the [changelog](CHANGELOG.md).

## Compatibility

DeepSeek Harness is still a Developer Preview. This release is verified only against `0.1.0-rc.8`; compatibility with other release candidates is not implied.

## License

[MIT](LICENSE)
