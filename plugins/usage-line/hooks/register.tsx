import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode, RenderViewport, SessionContextUsage } from 'claude-code'

import type { Limit, Line } from '../types'
import { BETWEEN, MUTED, WHITE, colorFor, mergeLimits, modelName, partsOf, roomNeeded, textOf, widthOf, windowsOf } from './format'
import type { Part } from './format'

const EMPTY: Line = { model: '', context: null, limits: [] }
const line = atom({ plugin: 'usage-line', key: 'line' } as const, EMPTY)
const tick = atom({ plugin: 'usage-line', key: 'tick' } as const, 0) // redraws the countdowns

const SYNC_MS = 2000
const TICK_MS = 1000
// The terminal footer's row: two columns of padding at each end, the mode label at the left
// (`⏵⏵ accept edits on ·`, the longest but bypass's) and the hint after it, two columns at least
// between that and what is drawn here.
const FOOTER_PADDING = 4
const FOOTER_GAP = 2
const MODE_LABEL = 20
const SEPARATOR = ' · '

const contextOf = (context: SessionContextUsage) =>
  context.percent === undefined ? null : { percent: context.percent, tokens: context.tokens ?? 0, window: context.window }

/** Whether a drawing beneath shows nothing: no text, no control (the engine's own node draws `modes`, counted apart). */
function isBlank (node: RenderNode | undefined): boolean {
  if (node === undefined || node === null) return true
  if (typeof node === 'string') return node.trim() === ''
  if (node.type === 'engine') return true
  return (node.type === 'Box' || node.type === 'Text') && (node.children ?? []).every(isBlank)
}

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

/**
 * Merges a reading into what this session and the shared store hold, each window at its newest, and
 * stores the result when it adds to the store. Every session settles on the same windows this way: a
 * stale reading never overwrites a newer one, and one that lacks a window keeps the known one.
 */
async function remember ($: EngineInterface, reading: Limit[]) {
  const saved = await $.store.get('limits')
  const stored = Array.isArray(saved) ? (saved as Limit[]) : []
  const limits = mergeLimits(stored, current.limits, reading)
  await show($, { limits })
  if (JSON.stringify(limits) !== JSON.stringify(stored)) await $.store.set('limits', limits)
}

async function sync ($: EngineInterface) {
  const [model, usage] = await Promise.all([$.session.model(), $.session.usage()])
  const context = contextOf(usage.context)
  await show($, context ? { model: modelName(model), context } : { model: modelName(model) })
  await remember($, windowsOf(usage.rateLimits))
}

/** Redraws when the countdown's text changes: every second when it shows seconds, every minute when minutes. */
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

/** The line itself: the model, then each letter and percentage with its details in parentheses. */
function draw ($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], model: string, parts: Part[]) {
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="row">
      {model ? <Text color={WHITE}>{model}</Text> : null}
      {parts.map((part, i) => (
        <Box key={part.label} flexDirection="row">
          {model || i > 0 ? <Text color={MUTED}>{BETWEEN}</Text> : null}
          <Text color={MUTED}>{part.label} </Text>
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
    const width = roomNeeded(data.model, parts) + (hasBeneath ? widthOfNode(beneath, e.props.modes) + SEPARATOR.length : 0)
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
