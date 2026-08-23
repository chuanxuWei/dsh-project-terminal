# Manual verification

Target: DeepSeek Harness `0.1.0-rc.8`, Web profile, local macOS Host.

## Package gates

```sh
CI=true pnpm install --frozen-lockfile
pnpm check
pnpm pack --dry-run
```

## Isolated Host

Use a fresh DSH home and a free port:

```sh
export DSH_HOME="$(mktemp -d)"
pnpm dlx @deepseek-ai/dsh@0.1.0-rc.8 plugin --profile web add .
pnpm dlx @deepseek-ai/dsh@0.1.0-rc.8 --profile web --dump-config
pnpm dlx @deepseek-ai/dsh@0.1.0-rc.8 web --port 0
```

Confirm the effective composition contains `dsh-project-terminal`, the Web endpoint returns HTTP 200, and the browser console has no current-port errors.

## Browser behavior

1. Open a project-backed Session and select **Terminal** in the sidebar footer.
2. Confirm the drawer path matches the Session checkout and ordinary shell input works.
3. Confirm the Action rail reflects `.dsh/environment.json`, or conventional `package.json` scripts when the file is absent.
4. Start Test/Lint and confirm the Action status settles with the exit code. Start Dev and confirm its detected port becomes **listening** and opens in a new browser tab.
5. Call `project_terminal_read` from the same Session. Confirm it reads recent output, and inspect the model tool list to confirm there is no project terminal write/Action tool.
6. Create a linked worktree Session with explicit `autoRunOnWorktree: true`. Confirm setup appears in the human terminal once, succeeds, and does not rerun for the same command digest after Host restart.
7. Stop the terminal and confirm its complete process tree and listening development port exit.
8. Exit the shell, use **Restart terminal**, and confirm a fresh Shell PID appears. At compact viewport width, horizontally scroll the status rail and confirm process and port cards remain reachable.

Only the exact DSH version, operating system, and flows observed above should be reported as verified.
