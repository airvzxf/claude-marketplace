import { expect, test } from 'claude-code/testing'

import { accountName, accountOf, colorFor, effortName, effortOfCommand, mergeLimits, modelName, roomNeeded, textOf, tokens, until, viewOf } from './format'
import type { Limit, Line } from '../types'

const HOUR = 3_600_000
const NOW = Date.parse('2026-11-02T12:00:00.000Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()
const lineOf = (line: Partial<Line>): Line => ({ account: '', model: '', effort: '', context: null, limits: [], ...line })

test('the model id reads as its family and version', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(modelName('claude-haiku-5-5-20261001')).toBe('Haiku 5.5')
  expect(modelName('claude-fable-5-1')).toBe('Fable 5.1')
  expect(modelName('some-other-model')).toBe('some-other-model')
})

test('the effort reads capitalized, a number as it is', () => {
  expect(effortName('xhigh')).toBe('Xhigh')
  expect(effortName('max')).toBe('Max')
  expect(effortName(42)).toBe('42')
  expect(effortName(undefined)).toBe('')
})

test('an /effort run tells the level it set, by its output or its arguments', () => {
  expect(effortOfCommand('max', 'Set effort level to max (this session only)')).toBe('Max')
  expect(effortOfCommand('', 'Set effort level to medium (saved as your default for new sessions)')).toBe('Medium')
  expect(effortOfCommand(' XHigh ', undefined)).toBe('Xhigh')
  expect(effortOfCommand('auto', 'Effort level set to auto')).toBe('')
  expect(effortOfCommand('', '')).toBe('')
})

test('tokens read in k and m', () => {
  expect(tokens(950)).toBe('950')
  expect(tokens(29_400)).toBe('29k')
  expect(tokens(200_000)).toBe('200k')
  expect(tokens(1_000_000)).toBe('1m')
})

test('the countdown shows the two largest units, seconds only under an hour', () => {
  expect(until(5 * 24 * HOUR + 19 * HOUR + 10 * 60_000)).toBe('5d 19h')
  expect(until(8 * HOUR + 59 * 60_000 + 30_000)).toBe('8h 59m')
  expect(until(20 * 60_000 + 5_000)).toBe('20m 5s')
  expect(until(59_000)).toBe('59s')
  expect(until(-1)).toBe('0s')
})

test('the color steps up at 50, 75 and 90 percent', () => {
  expect(colorFor(49)).toBe('#ffffff')
  expect(colorFor(50)).toBe('#e5c07b')
  expect(colorFor(75)).toBe('#e5904a')
  expect(colorFor(90)).toBe('#d75f5f')
})

test('the line carries a letter for each section', () => {
  const view = viewOf(lineOf({
    model: 'Opus 5.5',
    context: { percent: 12, tokens: 115_000, window: 1_000_000 },
    limits: [
      { kind: 'five_hour', percentUsed: 57, resetsAt: at(27 * 60_000 + 17_000) },
      { kind: 'seven_day', percentUsed: 8, resetsAt: at(6 * 24 * HOUR + 19 * HOUR + 30 * 60_000) }
    ]
  }), NOW)
  expect(textOf(view)).toBe('Opus 5.5 | C 12% (115k/1m) | H 57% (27m 17s) | W 8% (6d 19h)')
})

test('the effort follows the model, and the age of the reading closes the line', () => {
  const limits = [{ kind: 'five_hour', percentUsed: 9, resetsAt: at(3 * HOUR + 58 * 60_000 + 30_000) }]
  const view = (readAt: number) => viewOf(lineOf({ model: 'Opus 5.5', effort: 'Xhigh', limits, readAt }), NOW)
  expect(textOf(view(NOW - 5_000))).toBe('Opus 5.5 Xhigh | H 9% (3h 58m) | 5s ago')
  expect(textOf(view(NOW - (35 * 60_000 + 3_000)))).toBe('Opus 5.5 Xhigh | H 9% (3h 58m) | 35m 3s ago')
  expect(textOf(view(NOW - (HOUR + 35 * 60_000)))).toBe('Opus 5.5 Xhigh | H 9% (3h 58m) | 1h 35m ago')
})

test('no age without a reading time or without windows', () => {
  expect(textOf(viewOf(lineOf({ model: 'Opus 5.5', limits: [{ kind: 'five_hour', percentUsed: 9 }] }), NOW))).toBe('Opus 5.5 | H 9%')
  expect(textOf(viewOf(lineOf({ model: 'Opus 5.5', readAt: NOW }), NOW))).toBe('Opus 5.5')
})

test('a window not open, past its reset or with none and nothing used, shows N/A and no countdown', () => {
  const view = (limit: Limit) => textOf(viewOf(lineOf({ limits: [limit] }), NOW))
  expect(view({ kind: 'five_hour', percentUsed: 93, resetsAt: at(-1000) })).toBe('H N/A')
  expect(view({ kind: 'five_hour', percentUsed: 0 })).toBe('H N/A')
  expect(view({ kind: 'five_hour', percentUsed: 0, resetsAt: at(HOUR) })).toBe('H 0% (1h 0m)')
  expect(view({ kind: 'five_hour', percentUsed: 12 })).toBe('H 12%')
})

test('a stale reading never replaces a newer one, in either order', () => {
  const old = [{ kind: 'five_hour', percentUsed: 20, resetsAt: at(HOUR) }]
  const fresh = [{ kind: 'five_hour', percentUsed: 35, resetsAt: at(HOUR) }]
  expect(mergeLimits(old, fresh)).toEqual(fresh)
  expect(mergeLimits(fresh, old)).toEqual(fresh)
})

test('a new window wins over the last one, however used that was', () => {
  const ending = [{ kind: 'five_hour', percentUsed: 95, resetsAt: at(-HOUR) }]
  const next = [{ kind: 'five_hour', percentUsed: 3, resetsAt: at(4 * HOUR) }]
  expect(mergeLimits(next, ending)).toEqual(next)
  expect(mergeLimits(ending, next)).toEqual(next)
})

test('a reading that lacks a window keeps the one known before', () => {
  const both = [
    { kind: 'five_hour', percentUsed: 40, resetsAt: at(HOUR) },
    { kind: 'seven_day', percentUsed: 66, resetsAt: at(100 * HOUR) }
  ]
  const fiveHourOnly = [{ kind: 'five_hour', percentUsed: 41, resetsAt: at(HOUR) }]
  expect(mergeLimits(both, fiveHourOnly)).toEqual([fiveHourOnly[0], both[1]])
})

test('the room the line asks for does not change as the seconds go by', () => {
  const line = (ms: number, age = 0) =>
    viewOf(lineOf({ model: 'Opus 5.5', limits: [{ kind: 'five_hour', percentUsed: 57, resetsAt: at(ms) }], readAt: NOW - age }), NOW)
  expect(roomNeeded(line(27 * 60_000 + 9_000))).toBe(roomNeeded(line(27 * 60_000 + 10_000)))
  expect(roomNeeded(line(59_000))).toBe(roomNeeded(line(9 * HOUR)))
  expect(roomNeeded(line(HOUR, 5_000))).toBe(roomNeeded(line(HOUR, 35 * 60_000 + 3_000)))
})

test('the account reads as its whole address, its short form or nothing', () => {
  expect(accountName('someone.longname@example.com', 'full')).toBe('someone.longname@example.com')
  expect(accountName('someone.longname@example.com', 'short')).toBe('someone.lo*@example*')
  expect(accountName('ana@example.co.uk', 'short')).toBe('ana@example*')
  expect(accountName('ana@localhost', 'short')).toBe('ana@localhost')
  expect(accountName('someone.longname@example.com', 'none')).toBe('')
  expect(accountName('', 'full')).toBe('')
})

test('the login record names its account, and the windows it fetched for that account only', () => {
  const utilization = {
    five_hour: { utilization: 48, resets_at: at(HOUR) },
    seven_day: { utilization: 36, resets_at: at(50 * HOUR) },
    seven_day_opus: null
  }
  const oauthAccount = { accountUuid: 'a-1', emailAddress: 'ana@example.com', displayName: 'Ana' }
  expect(accountOf({ oauthAccount, cachedUsageUtilization: { accountUuid: 'a-1', fetchedAtMs: NOW, utilization } })).toEqual({
    id: 'a-1',
    email: 'ana@example.com',
    usage: {
      limits: [
        { kind: 'five_hour', percentUsed: 48, resetsAt: at(HOUR) },
        { kind: 'seven_day', percentUsed: 36, resetsAt: at(50 * HOUR) }
      ],
      readAt: NOW
    }
  })
  // Windows fetched for another account are not this one's.
  expect(accountOf({ oauthAccount, cachedUsageUtilization: { accountUuid: 'b-2', fetchedAtMs: NOW, utilization } })).toEqual({
    id: 'a-1',
    email: 'ana@example.com'
  })
  expect(accountOf({ oauthAccount: { emailAddress: 'ana@example.com' } })).toEqual({ id: 'ana@example.com', email: 'ana@example.com' })
  expect(accountOf({})).toBeUndefined()
  expect(accountOf(null)).toBeUndefined()
})

test('the account comes first on the line', () => {
  const view = viewOf(lineOf({ account: 'ana@example*', model: 'Opus 5.5', effort: 'Medium' }), NOW)
  expect(textOf(view)).toBe('ana@example* | Opus 5.5 Medium')
  expect(textOf(viewOf(lineOf({ account: 'ana@example*' }), NOW))).toBe('ana@example*')
})
