# Changelog

## 0.1.1 - 2026-08-24

- Restart exited Session shells on demand and release dead terminals from the configured terminal limit.
- Settle the active Action when its shell exits before the completion marker is emitted.
- Prevent stale project state from appearing while switching Sessions and recover cleanly after transient read failures.
- Add clearer active-Action, input-waiting, connecting, and exited status treatments.
- Keep Actions, setup, process, and development-port cards reachable in the compact mobile layout.

## 0.1.0 - 2026-08-21

- Add a Session/checkout-scoped user terminal drawer backed by DSH's subprocess PTY seam.
- Add project Actions, opt-in linked-worktree setup, Action status, process facts, and development port probes.
- Add the bounded read-only `project_terminal_read` Agent tool and loopback-only browser mutations.
