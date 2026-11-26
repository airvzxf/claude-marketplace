import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode, RenderViewport, SessionContextUsage } from 'claude-code'

import type { Account, Limit, Line } from '../types'
import { AGO, BETWEEN, MUTED, WHITE, ROSE, accountName, accountOf, colorFor, effortName, effortOfCommand, isEmpty, mergeLimits, modelName, roomNeeded, textOf, viewOf, widthOf, windowsOf } from './format'
import type { View } from './format'

const EMPTY: Line = { account: '', model: '', effort: '', context: null, limits: [] }
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
// The effort the settings named at the last read: a change there shows before the next request does.
let settingEffort: string | undefined
let lastText = ''
// The hint as last drawn on the terminal, in columns, and whether the line fit beside the mode label.
let hintWidth = 0
let isBelow = false
let timers: { cancel: () => void }[] = []
// How the line names the account: `full`, `short` or `none` (the `account` option).
let accountForm = 'short'
// The login record, the account it held at its last change, and that change's time: the record is read
// again only when it changes, as when another login is put in its place.
let configPath: string | undefined
let configMtime: number | undefined
let account: Account | undefined
// The account whose windows the line shows ('' with no login record), undefined before the first look.
let shownId: string | undefined
// The account the session's own last response came under: the windows the engine holds are that one's.
let readingId: string | undefined
// The accounts of the requests out now: a response under another account than `readingId` may replace
// what the engine holds at any moment, so until it is back, the engine's windows belong to no one sure.
let pending: string[] = []

const idOf = (a: Account | undefined) => a?.id ?? ''
// Each account keeps its windows under its own keys; with no login record, the keys of no account.
const keyOf = (id: string, key: 'limits' | 'readAt') => (id ? `${key}:${id}` : key)

/** Where the login record is: `~/.claude.json`, or beside the settings when they are moved. */
async function pathOfConfig ($: EngineInterface) {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (dir) return `${dir}/.claude.json`
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  return home ? `${home}/.claude.json` : undefined
}

/**
 * The account signed in on disk now. Each request is sent under the login on disk at the time, so a
 * login put in place of another, even with the session open, is the account the next one uses.
 * A record caught half written is read again at the next look.
 */
async function activeAccount ($: EngineInterface) {
  configPath ??= await pathOfConfig($)
  if (configPath === undefined) return account
  const { mtimeMs } = await $.fs.stat(configPath)
  if (mtimeMs === configMtime) return account
  account = accountOf(JSON.parse(await $.fs.read(configPath)))
  configMtime = mtimeMs
  return account
}

/** The account the engine's windows now belong to, or undefined while a request under another may be replacing them. */
const readingOwner = () => (readingId === undefined || pending.some(id => id !== readingId) ? undefined : readingId)

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
async function remember ($: EngineInterface, id: string, reading: Limit[], readAt?: number) {
  const [saved, savedAt] = await Promise.all([$.store.get(keyOf(id, 'limits')), $.store.get(keyOf(id, 'readAt'))])
  const stored = Array.isArray(saved) ? (saved as Limit[]) : []
  // Only the account shown has its windows on the line: another's are kept for when it is back.
  const isShown = id === shownId
  const limits = mergeLimits(stored, isShown ? current.limits : [], reading)
  // When any session last had a response, and so the windows a reading: the latest of them all.
  const storedAt = typeof savedAt === 'number' ? savedAt : undefined
  const times = [storedAt, isShown ? current.readAt : undefined, readAt].filter((t): t is number => t !== undefined)
  const latest = times.length > 0 ? Math.max(...times) : undefined
  if (isShown) await show($, latest === undefined ? { limits } : { limits, readAt: latest })
  if (JSON.stringify(limits) !== JSON.stringify(stored)) await $.store.set(keyOf(id, 'limits'), limits)
  if (latest !== undefined && latest !== storedAt) await $.store.set(keyOf(id, 'readAt'), latest)
}

/**
 * Looks at the login on disk: another account there than the one shown puts that one's windows on the
 * line at once (what this or another session read for it, or what its login record keeps), never the
 * windows of the account before.
 */
async function follow ($: EngineInterface) {
  const active = await activeAccount($).catch(() => account)
  const id = idOf(active)
  const name = accountName(active?.email ?? '', accountForm)
  if (id !== shownId) {
    shownId = id
    readingId ??= id // before any response, what the engine holds came under this login
    await show($, { account: name, limits: [], readAt: undefined })
  } else {
    await show($, { account: name })
  }
  await remember($, id, active?.usage?.limits ?? [], active?.usage?.readAt)
}

/** The effort the settings give the model: its own (`modelSettings`), else the one for all; '' when they name none. */
async function effortInSettings ($: EngineInterface, model: string) {
  const settings = await $.settings.read()
  const id = model.replace(/\[.*\]$/, '')
  const perModel = (settings.modelSettings as Record<string, { effortLevel?: unknown } | undefined> | undefined)?.[id]?.effortLevel
  const effort = perModel ?? settings.effortLevel
  return typeof effort === 'string' || typeof effort === 'number' ? effortName(effort) : ''
}

async function sync ($: EngineInterface) {
  const [model, usage] = await Promise.all([$.session.model(), $.session.usage()])
  const context = contextOf(usage.context)
  const effort = await effortInSettings($, model).catch(() => settingEffort ?? '')
  const patch: Partial<Line> = { model: modelName(model) }
  if (effort !== settingEffort) {
    // Settings that name no effort leave the model at its default, which they do not say: the
    // effort shown stays, and before anything showed one, the one the engine runs at.
    const first = settingEffort === undefined
    settingEffort = effort
    if (effort) patch.effort = effort
    else if (first && !current.effort) patch.effort = effortName(await $.env.get('CLAUDE_EFFORT').catch(() => undefined))
  }
  await show($, context ? { ...patch, context } : patch)
  await follow($)
  const owner = readingOwner()
  if (owner !== undefined) await remember($, owner, windowsOf(usage.rateLimits))
}

/** Redraws when the countdown's text changes: every second when it shows seconds, every minute when minutes. */
async function countdown ($: EngineInterface) {
  const text = textOf(viewOf(current, await $.clock.now()))
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

/**
 * The line itself: the account, the model and its effort, then each letter and percentage with its details in
 * parentheses, then how long ago the windows were read. The numbers are white (a percentage takes
 * its warning color); the account's words, its name, H, W and `ago`, are rose; the rest is gray.
 */
function draw ($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], { account, model, effort, parts, age }: View) {
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="row">
      {account ? <Text color={ROSE}>{account}</Text> : null}
      {account && model ? <Text color={MUTED}>{BETWEEN}</Text> : null}
      {model ? <Text color={WHITE}>{model}</Text> : null}
      {model && effort ? <Text color={MUTED}> {effort}</Text> : null}
      {parts.map((part, i) => (
        <Box key={part.label} flexDirection="row">
          {account || model || i > 0 ? <Text color={MUTED}>{BETWEEN}</Text> : null}
          <Text color={part.label === 'C' ? MUTED : ROSE}>{part.label} </Text>
          <Text color={colorFor(part.percent)}>{Math.round(part.percent)}%</Text>
          {part.detail ? <Text color={MUTED}> ({part.detail})</Text> : null}
        </Box>
      ))}
      {age ? <Text color={MUTED}>{BETWEEN}</Text> : null}
      {age ? <Text color={WHITE}>{age}</Text> : null}
      {age ? <Text color={ROSE}>{AGO}</Text> : null}
    </Box>
  )
}

export const register: Register = (on, options) => {
  accountForm = typeof options.account === 'string' ? options.account : 'short'
  configPath = undefined
  configMtime = undefined
  account = undefined
  shownId = undefined
  readingId = undefined
  pending = []
  current = EMPTY
  last = ''
  settingEffort = undefined
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

  // Each request to the model: main's names the effort it is sent at (after any downgrade for the
  // model), and every response, a subagent's too, is a new reading of the windows.
  // The request goes out under the login on disk as it starts, so its response reads that account's windows.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) void show($, { effort: effortName(e.effort) }).catch(() => {})
    const id = idOf(await activeAccount($).catch(() => account))
    pending.push(id)
    let result
    try {
      result = yield* next(e)
    } finally {
      pending.splice(pending.indexOf(id), 1)
    }
    readingId = id
    void (async () => {
      const [usage, now] = await Promise.all([$.session.usage(), $.clock.now()])
      await remember($, id, windowsOf(usage.rateLimits), now)
    })().catch(() => {})
    return result
  })

  // `/effort max`: the line shows the new level as soon as it is set, saved or for this session only.
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const result = await next(e)
    const effort = effortOfCommand(e.args, result.text)
    if (effort) await show($, { effort }).catch(() => {})
    return result
  })

  on('session.measure', async ($, e, next) => {
    const context = contextOf(e.context)
    if (context) await show($, { context })
    const owner = readingOwner()
    if (owner !== undefined) await remember($, owner, windowsOf(e.rateLimits))
    return next(e)
  })

  // Bottom right, beside the mode label, when the row has room for the whole line; what is beneath
  // (the engine's mode labels, another plugin's switch) stays after it.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const [data, , now, beneath] = await Promise.all([read($, line), read($, tick), $.clock.now(), next(e)])
    const view = viewOf(data, now)
    if (isEmpty(view)) {
      place($, false)
      return beneath
    }
    const hasBeneath = e.props.modes.length > 0 || !isBlank(beneath)
    const width = roomNeeded(view) + (hasBeneath ? widthOfNode(beneath, e.props.modes) + SEPARATOR.length : 0)
    const fits = width <= roomOf(e)
    place($, fits)
    if (!fits) return beneath

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        {draw($, e, view)}
        {hasBeneath ? <Text color={MUTED}>{SEPARATOR}</Text> : null}
        {beneath}
      </Box>
    )
  })

  // Where the footer has no room (a long hint, a narrow terminal): one row right above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || isBelow) return next(e)
    const [data, , now, beneath] = await Promise.all([read($, line), read($, tick), $.clock.now(), next(e)])
    const view = viewOf(data, now)
    if (isEmpty(view)) return beneath

    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {beneath}
        <Box key="usage-line" width={e.props.bodyColumns} justifyContent="flex-end">
          {draw($, e, view)}
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
