import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode, RenderViewport, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Limit, Line } from '../types'

const EMPTY: Line = { model: '', context: null, limits: [] }
const line = atom({ plugin: 'usage-line', key: 'line' } as const, EMPTY)
const tick = atom({ plugin: 'usage-line', key: 'tick' } as const, 0) // redraws the countdowns

const SYNC_MS = 2000
const TICK_MS = 1000
const WINDOWS = ['five_hour', 'seven_day']
const BETWEEN = ' | '
// The terminal footer's row: two columns of padding at each end, the mode label at the left
// (`⏵⏵ accept edits on ·`, the longest but bypass's) and the hint after it, two columns at least
// between that and what is drawn here.
const FOOTER_PADDING = 4
const FOOTER_GAP = 2
const MODE_LABEL = 20
const SEPARATOR = ' · '

// The percentage stands out; the separators and what is in parentheses stay in the background.
const WHITE = '#ffffff'
const YELLOW = '#e5c07b'
const ORANGE = '#e5904a'
const RED = '#d75f5f'
const MUTED = '#a8a8a8'

const colorFor = (percent: number) => (percent >= 90 ? RED : percent >= 75 ? ORANGE : percent >= 50 ? YELLOW : WHITE)

/** "claude-opus-5-5[1m]" → "Opus 5.5"; an id it does not know stays as it is. */
function modelName (id: string) {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[.*\])?$/.exec(id)
  if (!match) return id
  const [, family = '', major, minor] = match
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
}

/** 29400 → "29k", 1000000 → "1m", 200000 → "200k". */
function tokens (n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}m`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

/** "5d 19h", "8h 59m", "20m 5s", "59s": how long until the window resets. */
function until (ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

const windowsOf = (rateLimits: readonly SessionRateLimit[]): Limit[] =>
  WINDOWS.flatMap(kind => {
    const found = rateLimits.find(limit => limit.kind === kind)
    return found ? [{ kind, percentUsed: found.percentUsed, resetsAt: found.resetsAt }] : []
  })

const contextOf = (context: SessionContextUsage) =>
  context.percent === undefined ? null : { percent: context.percent, tokens: context.tokens ?? 0, window: context.window }

type Part = { percent: number; detail: string }

/** The percentages to draw, each with what goes in its parentheses. */
function partsOf ({ context, limits }: Line, now: number): Part[] {
  const parts: Part[] = []
  if (context) parts.push({ percent: context.percent, detail: `${tokens(context.tokens)}/${tokens(context.window)}` })
  for (const limit of limits) {
    const resetsIn = limit.resetsAt === undefined ? undefined : Date.parse(limit.resetsAt) - now
    const hasReset = resetsIn !== undefined && resetsIn <= 0
    parts.push({ percent: hasReset ? 0 : limit.percentUsed, detail: resetsIn === undefined || hasReset ? '' : until(resetsIn) })
  }
  return parts
}

/** The line as plain text: what it measures on the terminal, and what tells the countdown a redraw is due. */
const textOf = (model: string, parts: Part[]) =>
  [...(model ? [model] : []), ...parts.map(p => `${Math.round(p.percent)}%${p.detail ? ` (${p.detail})` : ''}`)].join(BETWEEN)

/** Whether a drawing beneath shows nothing: no text, no control (the engine's own node draws `modes`, counted apart). */
function isBlank (node: RenderNode | undefined): boolean {
  if (node === undefined || node === null) return true
  if (typeof node === 'string') return node.trim() === ''
  if (node.type === 'engine') return true
  return (node.type === 'Box' || node.type === 'Text') && (node.children ?? []).every(isBlank)
}

/** Columns a text takes: one per character, none for a variation selector. */
const widthOf = (text: string) => [...text.replace(/[︎️]/g, '')].length

/** Columns a drawing beneath takes on one row; the engine's own node draws `modes`, joined by ` & `. */
function widthOfNode (node: RenderNode | undefined, modes: readonly string[]): number {
  if (node === undefined || node === null) return 0
  if (typeof node === 'string') return widthOf(node)
  if (node.type === 'engine') return widthOf(modes.join(' & '))
  return (node.children ?? []).reduce((sum, child) => sum + widthOfNode(child, modes), 0)
}

let current: Line = EMPTY
let last = ''
let lastText = ''
let seenAt = 0
// The hint as last drawn on the terminal, in columns, and whether the line fit beside the mode label.
let hintWidth = 0
let isBelow = false
let timers: { cancel: () => void }[] = []

/** Columns the footer leaves at its right end on the terminal, beside the mode label and the hint; elsewhere, no limit. */
function roomOf (e: { surface: string; viewport?: RenderViewport }) {
  if (e.surface !== 'terminal' || e.viewport === undefined) return Infinity
  return e.viewport.columns - FOOTER_PADDING - FOOTER_GAP - MODE_LABEL - (hintWidth > 0 ? 1 + hintWidth : 0)
}

/** Writes the line when something in it changed (an equal write would redraw for nothing). */
async function show ($: EngineInterface, patch: Partial<Line>) {
  const next = { ...current, ...patch }
  const key = JSON.stringify(next)
  if (key === last) return
  last = key
  current = next
  await update($, line, () => next)
}

/** Keeps the latest rate limits, shared with the other sessions until one of them measures newer. */
async function remember ($: EngineInterface, limits: Limit[]) {
  if (limits.length === 0) return
  seenAt = await $.clock.now()
  await show($, { limits })
  await $.store.set('limits', limits)
  await $.store.set('at', seenAt) // after the limits, so a reader that sees the new time finds the new limits
}

async function sync ($: EngineInterface) {
  const [model, usage, at] = await Promise.all([$.session.model(), $.session.usage(), $.store.get('at')])
  const patch: Partial<Line> = { model: modelName(model) }
  const context = contextOf(usage.context)
  if (context) patch.context = context
  if (Number(at) > seenAt) {
    const saved = await $.store.get('limits')
    if (Array.isArray(saved)) {
      seenAt = Number(at)
      patch.limits = saved as Limit[]
    }
  }
  await show($, patch)
  await remember($, windowsOf(usage.rateLimits))
}

/** Redraws when the countdown's text changes: every second under an hour, every minute above. */
async function countdown ($: EngineInterface) {
  const text = textOf(current.model, partsOf(current, await $.clock.now()))
  if (text === lastText) return
  lastText = text
  await update($, tick, n => n + 1)
}

/** Tells the band above the prompt whether the footer took the line, so it is drawn in one place only. */
function place ($: EngineInterface, below: boolean) {
  if (below === isBelow) return
  isBelow = below
  $.ui.invalidate('ui.render')
}

/** The line itself: the model, then each percentage with its details in parentheses. */
function draw ($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], model: string, parts: Part[]) {
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="row">
      {model ? <Text color={WHITE}>{model}</Text> : null}
      {parts.map((part, i) => (
        <Box key={String(i)} flexDirection="row">
          {model || i > 0 ? <Text color={MUTED}>{BETWEEN}</Text> : null}
          <Text color={colorFor(part.percent)}>{Math.round(part.percent)}%</Text>
          {part.detail ? <Text color={MUTED}> ({part.detail})</Text> : null}
        </Box>
      ))}
    </Box>
  )
}

export const register: Register = on => {
  current = EMPTY
  last = ''
  lastText = ''
  seenAt = 0
  hintWidth = 0
  isBelow = false
  timers.forEach(t => t.cancel())
  timers = []

  on('session.start', async ($, e, next) => {
    timers.forEach(t => t.cancel())
    await sync($)
    if (e.isInteractive) {
      timers = [
        $.clock.every(SYNC_MS, () => void sync($).catch(() => {})), // a failed read keeps the line on screen
        $.clock.every(TICK_MS, () => void countdown($).catch(() => {}))
      ]
    }
    return next(e)
  })

  on('session.end', ($, e, next) => {
    timers.forEach(t => t.cancel())
    timers = []
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const context = contextOf(e.context)
    if (context) await show($, { context })
    await remember($, windowsOf(e.rateLimits))
    return next(e)
  })

  // Bottom right, beside the mode label, when the row has room for the whole line; what is beneath
  // (the engine's mode labels, another plugin's switch) stays after it.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const [data, , now, beneath] = await Promise.all([read($, line), read($, tick), $.clock.now(), next(e)])
    const parts = partsOf(data, now)
    if (!data.model && parts.length === 0) {
      place($, false)
      return beneath
    }
    const hasBeneath = e.props.modes.length > 0 || !isBlank(beneath)
    const width = widthOf(textOf(data.model, parts)) + (hasBeneath ? widthOfNode(beneath, e.props.modes) + SEPARATOR.length : 0)
    const fits = width <= roomOf(e)
    place($, fits)
    if (!fits) return beneath

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        {draw($, e, data.model, parts)}
        {hasBeneath ? <Text color={MUTED}>{SEPARATOR}</Text> : null}
        {beneath}
      </Box>
    )
  })

  // Where the footer has no room (a long hint, a narrow terminal): one row right above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || isBelow) return next(e)
    const [data, , now, beneath] = await Promise.all([read($, line), read($, tick), $.clock.now(), next(e)])
    const parts = partsOf(data, now)
    if (!data.model && parts.length === 0) return beneath

    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {beneath}
        <Box key="usage-line" width={e.props.bodyColumns} justifyContent="flex-end">
          {draw($, e, data.model, parts)}
        </Box>
      </Box>
    )
  })

  // The hint line after the mode label ("(shift+tab to cycle)", "esc to interrupt", messages): its width
  // tells the footer how much room is left for the line.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    if (e.surface === 'terminal') {
      const width = widthOf(e.props.hint)
      if (width !== hintWidth) {
        hintWidth = width
        $.ui.invalidate('ui.render')
      }
    }
    return next(e)
  })
}
