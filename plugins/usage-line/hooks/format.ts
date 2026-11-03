import type { SessionRateLimit } from 'claude-code'

import type { Limit, Line } from '../types'

export const WINDOWS = ['five_hour', 'seven_day']
const LABELS: Record<string, string> = { five_hour: 'H', seven_day: 'W' }
export const BETWEEN = ' | '
// Two readings of one window may name its reset a little apart; further than this, they are two windows.
const SAME_WINDOW_MS = 5 * 60_000
// The widest a countdown gets ("59m 59s", "23h 59m"), so the line's width does not change by the second.
const DETAIL_WIDTH = 7

// The percentage stands out; the letters, the separators and what is in parentheses stay in the background.
export const WHITE = '#ffffff'
const YELLOW = '#e5c07b'
const ORANGE = '#e5904a'
const RED = '#d75f5f'
export const MUTED = '#a8a8a8'

export const colorFor = (percent: number) => (percent >= 90 ? RED : percent >= 75 ? ORANGE : percent >= 50 ? YELLOW : WHITE)

/** "claude-opus-5-5[1m]" → "Opus 5.5"; an id it does not know stays as it is. */
export function modelName (id: string) {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[.*\])?$/.exec(id)
  if (!match) return id
  const [, family = '', major, minor] = match
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
}

/** 29400 → "29k", 1000000 → "1m", 200000 → "200k". */
export function tokens (n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}m`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

/** "5d 19h", "8h 59m", "20m 5s", "59s": how long until the window resets. */
export function until (ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export const windowsOf = (rateLimits: readonly SessionRateLimit[]): Limit[] =>
  WINDOWS.flatMap(kind => {
    const found = rateLimits.find(limit => limit.kind === kind)
    return found ? [{ kind, percentUsed: found.percentUsed, resetsAt: found.resetsAt }] : []
  })

const resetOf = (limit: Limit) => (limit.resetsAt === undefined ? 0 : Date.parse(limit.resetsAt) || 0)

/** Of two readings of one window, the newer: a later reset is a new window, and within one window usage only grows. */
function newer (a: Limit, b: Limit): Limit {
  const gap = resetOf(b) - resetOf(a)
  if (Math.abs(gap) > SAME_WINDOW_MS) return gap > 0 ? b : a
  return b.percentUsed >= a.percentUsed ? b : a
}

/**
 * Every window from all the readings given, each at its newest. It depends on no clock or order, so
 * two sessions merging what each other stored settle on the same windows instead of taking turns, and
 * a reading that lacks a window leaves the one known before in place.
 */
export function mergeLimits (...readings: readonly (readonly Limit[])[]): Limit[] {
  return WINDOWS.flatMap(kind => {
    const found = readings.flatMap(reading => reading.filter(limit => limit.kind === kind))
    return found.length === 0 ? [] : [found.reduce(newer)]
  })
}

export type Part = { label: string; percent: number; detail: string }

/** The percentages to draw, each with its letter and what goes in its parentheses. */
export function partsOf ({ context, limits }: Line, now: number): Part[] {
  const parts: Part[] = []
  if (context) parts.push({ label: 'C', percent: context.percent, detail: `${tokens(context.tokens)}/${tokens(context.window)}` })
  for (const limit of limits) {
    const resetsIn = limit.resetsAt === undefined ? undefined : Date.parse(limit.resetsAt) - now
    const hasReset = resetsIn !== undefined && resetsIn <= 0
    parts.push({
      label: LABELS[limit.kind] ?? limit.kind,
      percent: hasReset ? 0 : limit.percentUsed,
      detail: resetsIn === undefined || hasReset ? '' : until(resetsIn)
    })
  }
  return parts
}

/** The line as plain text: what tells the countdown a redraw is due. */
export const textOf = (model: string, parts: Part[]) =>
  [...(model ? [model] : []), ...parts.map(p => `${p.label} ${Math.round(p.percent)}%${p.detail ? ` (${p.detail})` : ''}`)].join(BETWEEN)

/** Columns a text takes: one per character, none for a variation selector. */
export const widthOf = (text: string) => [...text.replace(/[︎️]/g, '')].length

/**
 * The columns the line asks of the footer, each countdown counted at its widest: the row it is drawn
 * in then changes only when the room does, not as the seconds go by.
 */
export const roomNeeded = (model: string, parts: Part[]) =>
  widthOf(textOf(model, parts.map(p => ({ ...p, detail: p.detail.length > 0 && p.label !== 'C' ? p.detail.padEnd(DETAIL_WIDTH) : p.detail }))))
