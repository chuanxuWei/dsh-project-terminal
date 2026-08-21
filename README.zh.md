# DSH Project Terminal

[English](README.md)

> DeepSeek Harness Web 中按 Session 隔离的“人用终端”，集成项目 Actions、worktree setup 和实时开发状态。

`dsh-project-terminal` 把终端保留为用户操作界面，同时让当前 Agent 能理解终端里发生了什么。每个终端都绑定一个 DSH Session 的权威 Checkout：浏览器用户可以输入命令、运行 Actions、中断或停止进程；Agent 只有有界、只读的 `project_terminal_read` 工具。

## 为什么需要它

Agent 修改项目后，用户应该能直接复跑测试、检查输出或启动开发服务器，不必离开 DSH；但这个“人用终端”也不应该在无提示的情况下变成模型可以自动操作的另一套 Shell。

插件明确分开两条权限路径：

| 能力 | 浏览器用户 | Agent |
| --- | :---: | :---: |
| 读取终端输出和状态 | 可以 | 可以，但有界 |
| 向终端输入 | 可以 | 不可以 |
| 运行项目 Actions 或 setup | 可以 | 不可以 |
| 中断或停止进程 | 可以 | 不可以 |

## 功能

- 当前每个 Session/Checkout 一个保留状态的 xterm 终端。
- 自动从 `package.json` 发现 `Run`、`Test`、`Lint`、`Dev`、`Build`。
- 通过 `.dsh/environment.json` 定义项目 Actions 和平台化 setup。
- DSH 为 linked Git worktree 创建 Session 时，可显式选择自动 setup。
- 实时显示 Shell PID、前台进程组、Action 结果和经过 loopback 探测的开发端口。
- 通过 DSH 支持的 `sidebar.footer.action` 槽位挂载，并支持 <kbd>Ctrl</kbd> + <kbd>&#96;</kbd> 快捷键。
- cwd 由 Host 根据 Session 解析，浏览器请求不能替换成其他 Checkout 路径。
- Agent 只有有界读取工具，没有对应的写入或 Action 工具。

## 快速开始

需要 Node.js `22.19+`、pnpm `11.19+` 和 DeepSeek Harness `0.1.0-rc.8`。

```sh
git clone https://github.com/chuanxuWei/dsh-project-terminal.git
cd dsh-project-terminal
pnpm install --frozen-lockfile
pnpm check
pnpm dlx @deepseek-ai/dsh@0.1.0-rc.8 plugin --profile web add .
pnpm dlx @deepseek-ai/dsh@0.1.0-rc.8 web
```

打开一个项目 Session，然后点击侧边栏底部的 **终端**，或按 <kbd>Ctrl</kbd> + <kbd>&#96;</kbd>。没有配置文件时，插件会自动把 `package.json` 中的常用脚本显示为 Actions。

## 项目配置

项目需要 setup 或自定义 Actions 时，加入 `.dsh/environment.json`：

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

`darwin`、`linux` 或 `win32` 会覆盖当前平台的默认 `command`。

自动 setup 只有在三个条件同时成立时才运行：

1. Session cwd 是 linked Git worktree。
2. 仓库明确设置了 `autoRunOnWorktree: true`。
3. 当前 Checkout 尚未成功执行完全相同的 setup 命令摘要。

成功记录会原子写入当前 DSH home；平台命令发生变化后，setup 会重新变成待执行状态。

## 安全模型

插件不复用 Agent 所有的 `ctx.terminals` 注册表，而是通过 `ctx.subprocess.spawnTerminal()` 创建独立的人用 PTY。浏览器写操作只通过 Connection Server 的 `loopback` 路由开放；每次操作都会从当前或持久化 Session header 重新解析 cwd。

模型侧只注册 `project_terminal_read`。它根据发起调用的 Agent 精确 Session id，返回有界的末尾输出、进程和端口状态；没有任何模型工具可以输入、运行 Action、执行 setup、发送信号或关闭终端。

命令仍使用 DSH Host 用户的操作系统权限执行。这里实现的是用户界面和 Agent 工具之间的授权边界，不是操作系统沙箱。开启自动 setup 前应审查仓库配置。

## 验证记录

版本 `0.1.0` 已针对 DSH `0.1.0-rc.8` 完成：

- 冻结依赖安装、TypeScript 构建、包权限检查和 `pnpm pack --dry-run`；
- 6 个 Vitest 文件、10 个测试，包括 linked-worktree setup 和 Agent 精确 Session 读取；
- 安装到隔离的 DSH Web Profile，并检查最终组合配置；
- 真实 Host 监听/HTTP 和浏览器交互验证；
- 终端输入、Test Action 成功状态、开发端口发现、中断处理和零浏览器错误。

更多信息见[架构说明](docs/architecture.md)、[手工验证](docs/manual-verification.md)和[更新日志](CHANGELOG.md)。

## 兼容性

DeepSeek Harness 仍处于 Developer Preview。本版本只对 `0.1.0-rc.8` 做过验证，不承诺兼容其他候选版本。

## 许可证

[MIT](LICENSE)
