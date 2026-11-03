import { expect, test } from 'claude-code/testing'

import { colorFor, mergeLimits, modelName, partsOf, roomNeeded, textOf, tokens, until } from './format'

const HOUR = 3_600_000
const NOW = Date.parse('2026-11-02T12:00:00.000Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()

test('the model id reads as its family and version', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(modelName('claude-haiku-5-5-20261001')).toBe('Haiku 5.5')
  expect(modelName('claude-fable-5-1')).toBe('Fable 5.1')
  expect(modelName('some-other-model')).toBe('some-other-model')
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
  const parts = partsOf({
    model: 'Opus 5.5',
    context: { percent: 12, tokens: 115_000, window: 1_000_000 },
    limits: [
      { kind: 'five_hour', percentUsed: 57, resetsAt: at(27 * 60_000 + 17_000) },
      { kind: 'seven_day', percentUsed: 8, resetsAt: at(6 * 24 * HOUR + 19 * HOUR + 30 * 60_000) }
    ]
  }, NOW)
  expect(textOf('Opus 5.5', parts)).toBe('Opus 5.5 | C 12% (115k/1m) | H 57% (27m 17s) | W 8% (6d 19h)')
})

test('a window past its reset shows 0% and no countdown', () => {
  const parts = partsOf({ model: '', context: null, limits: [{ kind: 'five_hour', percentUsed: 93, resetsAt: at(-1000) }] }, NOW)
  expect(textOf('', parts)).toBe('H 0%')
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
  const line = (ms: number) => partsOf({ model: 'Opus 5.5', context: null, limits: [{ kind: 'five_hour', percentUsed: 57, resetsAt: at(ms) }] }, NOW)
  expect(roomNeeded('Opus 5.5', line(27 * 60_000 + 9_000))).toBe(roomNeeded('Opus 5.5', line(27 * 60_000 + 10_000)))
  expect(roomNeeded('Opus 5.5', line(59_000))).toBe(roomNeeded('Opus 5.5', line(9 * HOUR)))
})
