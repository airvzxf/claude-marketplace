import { expect, test } from 'claude-code/testing'

const NOW = Date.parse('2026-11-02T12:00:00.000Z')
const RESET_5H = new Date(NOW + 27 * 60_000 + 17_000).toISOString()
const RESET_WEEK = new Date(NOW + (6 * 24 + 19) * 3_600_000 + 60_000).toISOString()

test('a session holding a stale reading draws, and keeps, the newer one another session stored', async ($, on) => {
  // Another session measured 57% and stored it; this one still holds its own 40% from before.
  let stored: unknown = [
    { kind: 'five_hour', percentUsed: 57, resetsAt: RESET_5H },
    { kind: 'seven_day', percentUsed: 8, resetsAt: RESET_WEEK }
  ]
  on('store.get', () => ({ value: stored }))
  on('store.set', (_, e) => {
    stored = e.value
    return { value: undefined }
  })
  on('clock.now', () => ({ value: NOW }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { tokens: 115_000, window: 1_000_000, percent: 12 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: RESET_5H }]
    }
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // The engine draws nothing beneath: the footer holds only this line.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })

  const ui = await $.ui.mount({ plugin: 'usage-line', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const texts = (await ui.findAll({ type: 'Text' })).map(node => node.text).join('')
  expect(texts).toBe('Opus 5.5 | C 12% (115k/1m) | H 57% (27m 17s) | W 8% (6d 19h)')
  expect(stored).toEqual([
    { kind: 'five_hour', percentUsed: 57, resetsAt: RESET_5H },
    { kind: 'seven_day', percentUsed: 8, resetsAt: RESET_WEEK }
  ])
  await ui.unmount()
})
