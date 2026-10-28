/** A subscription window: `five_hour` or `seven_day`, how much of it is used (0 to 100) and when it resets. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** What the line shows: the model's name, the context window's fill (null until a response) and the windows. */
export type Line = {
  model: string
  context: { percent: number; tokens: number; window: number } | null
  limits: Limit[]
}

declare module 'claude-code' {
  interface PluginState {
    'usage-line': { line: Line; tick: number }
  }
}
