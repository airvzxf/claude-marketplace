import type { SessionRateLimit } from 'claude-code'

import type { Account, Limit, Line } from '../types'

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
// The account's own: the letters of its windows (H, W) and the word after their age, in a greyed rose
// that groups the three apart from the session's context, and from the percentages' colors.
export const ROSE = '#b48a9b'

export const colorFor = (percent: number) => (percent >= 90 ? RED : percent >= 75 ? ORANGE : percent >= 50 ? YELLOW : WHITE)

/** "claude-opus-5-5[1m]" → "Opus 5.5"; an id it does not know stays as it is. */
export function modelName (id: string) {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[.*\])?$/.exec(id)
  if (!match) return id
  const [, family = '', major, minor] = match
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
}

/** "xhigh" → "Xhigh", "max" → "Max"; a number stays as it is. */
export function effortName (effort: string | number | undefined) {
  if (effort === undefined) return ''
  const text = String(effort)
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * The effort an `/effort` run left the session at: what its output says it set ("Set effort level to
 * max ..."), else the level its arguments name; '' when neither tells (`/effort auto`, the picker closed).
 */
export function effortOfCommand (args: string, output: string | undefined) {
  const said = /\beffort(?: level)? to (\w+)/i.exec(output ?? '')?.[1]?.toLowerCase()
  if (said !== undefined && LEVELS.includes(said)) return effortName(said)
  const asked = args.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return LEVELS.includes(asked) ? effortName(asked) : ''
}

/** 29400 → "29k", 1000000 → "1m", 200000 → "200k". */
export function tokens (n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}m`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

/** "5d 19h", "8h 59m", "20m 5s", "59s": how long until the window resets, or since it was read. */
export function until (ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

// How much of an address the short form keeps: the start of the name, the domain's first label.
const NAME_KEPT = 10

/**
 * The account as the line names it: `full`, the whole address; `short`, the start of its name and of
 * its domain ("someone.lo*@example*"); `none` (or no address), ''.
 */
export function accountName (email: string, form: string) {
  if (form === 'none' || email === '') return ''
  if (form === 'full') return email
  const at = email.lastIndexOf('@')
  const name = at < 0 ? email : email.slice(0, at)
  const short = name.length > NAME_KEPT ? `${name.slice(0, NAME_KEPT)}*` : name
  if (at < 0) return short
  const domain = email.slice(at + 1)
  const dot = domain.indexOf('.')
  return `${short}@${dot > 0 ? `${domain.slice(0, dot)}*` : domain}`
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/**
 * The account a login record (`~/.claude.json`) holds: its `oauthAccount`, and the windows its
 * `cachedUsageUtilization` names when they were fetched for that same account. Undefined with no login.
 */
export function accountOf (config: unknown): Account | undefined {
  if (!isRecord(config) || !isRecord(config.oauthAccount)) return undefined
  const { accountUuid, emailAddress } = config.oauthAccount
  const id = typeof accountUuid === 'string' ? accountUuid : ''
  const email = typeof emailAddress === 'string' ? emailAddress : ''
  if (!id && !email) return undefined
  const account: Account = { id: id || email, email }
  const cached = config.cachedUsageUtilization
  if (isRecord(cached) && cached.accountUuid === id && typeof cached.fetchedAtMs === 'number' && isRecord(cached.utilization)) {
    const utilization = cached.utilization
    const limits = WINDOWS.flatMap(kind => {
      const found = utilization[kind]
      if (!isRecord(found) || typeof found.utilization !== 'number') return []
      return [{ kind, percentUsed: found.utilization, ...(typeof found.resets_at === 'string' ? { resetsAt: found.resets_at } : {}) }]
    })
    if (limits.length > 0) account.usage = { limits, readAt: cached.fetchedAtMs }
  }
  return account
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

/** One percentage on the line; `percent` null for a window that is not open (`N/A`). */
export type Part = { label: string; percent: number | null; detail: string }

export const NOT_OPEN = 'N/A'

/** "H 15%", or "H N/A" for a window that is not open. */
export const percentOf = (part: Part) => (part.percent === null ? NOT_OPEN : `${Math.round(part.percent)}%`)

/** What the line draws: the account, the model and its effort, each percentage, and how long ago the windows were read ('' unknown). */
export type View = { account: string; model: string; effort: string; parts: Part[]; age: string }

/** The percentages to draw, each with its letter and what goes in its parentheses. */
export function partsOf ({ context, limits }: Line, now: number): Part[] {
  const parts: Part[] = []
  if (context) parts.push({ label: 'C', percent: context.percent, detail: `${tokens(context.tokens)}/${tokens(context.window)}` })
  for (const limit of limits) {
    const resetsIn = limit.resetsAt === undefined ? undefined : Date.parse(limit.resetsAt) - now
    // A window opens with the first request after the last one closed: until then, past its reset or
    // with none and nothing used, there is no window to count.
    const isOpen = resetsIn === undefined ? limit.percentUsed > 0 : resetsIn > 0
    parts.push({
      label: LABELS[limit.kind] ?? limit.kind,
      percent: isOpen ? limit.percentUsed : null,
      detail: resetsIn === undefined || !isOpen ? '' : until(resetsIn)
    })
  }
  return parts
}

/** The line at a moment: the age is shown only beside the windows it dates. */
export const viewOf = (line: Line, now: number): View => ({
  account: line.account,
  model: line.model,
  effort: line.effort,
  parts: partsOf(line, now),
  age: line.readAt === undefined || line.limits.length === 0 ? '' : until(now - line.readAt)
})

export const isEmpty = (view: View) => !view.account && !view.model && view.parts.length === 0

/** The model's name, then its effort after a space. */
export const headOf = ({ model, effort }: View) => (model && effort ? `${model} ${effort}` : model)

export const AGO = ' ago'

/** The line as plain text: what tells the countdown a redraw is due. */
export const textOf = (view: View) =>
  [
    ...(view.account ? [view.account] : []),
    ...(view.model ? [headOf(view)] : []),
    ...view.parts.map(p => `${p.label} ${percentOf(p)}${p.detail ? ` (${p.detail})` : ''}`),
    ...(view.age ? [`${view.age}${AGO}`] : [])
  ].join(BETWEEN)

/** Columns a text takes: one per character, none for a variation selector. */
export const widthOf = (text: string) => [...text.replace(/[︎️]/g, '')].length

/**
 * The columns the line asks of the footer, each countdown and the age counted at their widest: the
 * row it is drawn in then changes only when the room does, not as the seconds go by.
 */
export const roomNeeded = (view: View) =>
  widthOf(textOf({
    ...view,
    parts: view.parts.map(p => ({ ...p, detail: p.detail.length > 0 && p.label !== 'C' ? p.detail.padEnd(DETAIL_WIDTH) : p.detail })),
    age: view.age.padEnd(view.age ? DETAIL_WIDTH : 0)
  }))
