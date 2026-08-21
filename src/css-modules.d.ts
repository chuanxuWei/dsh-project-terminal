declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export function mountCss(): () => void
  export default classes
}

declare module '@xterm/xterm/css/xterm.css' {
  export function mountCss(): () => void
}
