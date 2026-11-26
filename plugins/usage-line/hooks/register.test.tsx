import { expect, mock, test } from 'claude-code/testing'

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

test('the effort comes from the settings, then from each request; the age counts from the last response', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const stored: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('settings.read', () => ({ value: { effortLevel: 'high', modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } } }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('session.usage', () => ({
    value: { startedAt: NOW, context: { window: 1_000_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 9, resetsAt: RESET_5H }] }
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.step', async function * (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  const text = async () => {
    const ui = await $.ui.mount({ plugin: 'usage-line', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
    const texts = (await ui.findAll({ type: 'Text' })).map(node => node.text).join('')
    await ui.unmount()
    return texts
  }
  // No response yet: the effort the settings give this model, and no age.
  expect(await text()).toBe('Opus 5.5 Xhigh | H 9% (27m 17s)')

  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })
  for await (const _ of step) { /* drained */ }
  await step.result
  await clock.advance(20 * 60_000 + 5_000)
  expect(await text()).toBe('Opus 5.5 Medium | H 9% (7m 12s) | 20m 5s ago')
  expect(stored.readAt).toBe(NOW) // for the other sessions to show
})

test('/effort changes the effort shown at once, before and between prompts', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { CLAUDE_EFFORT: 'medium' })
  // The default effort: the settings name none.
  on('settings.read', () => ({ value: {} }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', (_, e) => ({ text: `Set effort level to ${e.args} (this session only)` }))
  on('turn.step', async function * (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  const text = async () => {
    const ui = await $.ui.mount({ plugin: 'usage-line', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
    const texts = (await ui.findAll({ type: 'Text' })).map(node => node.text).join('')
    await ui.unmount()
    return texts
  }
  const effort = (args: string) =>
    $.command.run({ command: 'effort', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  const prompt = async (level: 'max' | 'xhigh') => {
    const step = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: level, messageCount: 1 })
    for await (const _ of step) { /* drained */ }
    await step.result
  }

  expect(await text()).toBe('Opus 5.5 Medium')
  await effort('max')
  expect(await text()).toBe('Opus 5.5 Max')
  await prompt('max')
  expect(await text()).toBe('Opus 5.5 Max')
  await effort('xhigh')
  expect(await text()).toBe('Opus 5.5 Xhigh')
})

test('another login put on disk mid-session shows its own account and windows, never the ones before', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const stored: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  mock.env(on, { HOME: '/home/someone' })
  const ana = { oauthAccount: { accountUuid: 'a-1', emailAddress: 'ana.longname@example.com' } }
  const bob = {
    oauthAccount: { accountUuid: 'b-2', emailAddress: 'bob@example.org' },
    // What the login record kept of this account's windows when it was last in use.
    cachedUsageUtilization: {
      accountUuid: 'b-2',
      fetchedAtMs: NOW - 60_000,
      utilization: { five_hour: { utilization: 10, resets_at: RESET_5H }, seven_day: { utilization: 70, resets_at: RESET_WEEK } }
    }
  }
  let config: unknown = ana
  let mtimeMs = 1
  on('fs.stat', (_, e) => {
    expect(e.path).toBe('/home/someone/.claude.json')
    return { value: { kind: 'file', size: 1, mtimeMs, isLink: false } }
  })
  on('fs.read', () => ({ value: JSON.stringify(config) }))
  // The windows the engine holds: those the last response reported.
  let rateLimits = [{ kind: 'five_hour', percentUsed: 40, resetsAt: RESET_5H }]
  on('settings.read', () => ({ value: {} }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 1_000_000 }, rateLimits } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.step', async function * (_, e) {
    rateLimits = [{ kind: 'five_hour', percentUsed: 15, resetsAt: RESET_5H }]
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  const text = async () => {
    const ui = await $.ui.mount({ plugin: 'usage-line', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
    const texts = (await ui.findAll({ type: 'Text' })).map(node => node.text).join('')
    await ui.unmount()
    return texts
  }
  const login = async (next: unknown) => {
    config = next
    mtimeMs += 1
    await clock.advance(2000)
  }

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await text()).toBe('ana.longna*@example* | Opus 5.5 | H 40% (27m 17s)')

  // The engine still holds ana's 40% until a response comes under bob.
  await login(bob)
  expect(await text()).toBe('bob@example* | Opus 5.5 | H 10% (27m 15s) | W 70% (6d 19h) | 1m 2s ago')
  expect(stored['limits:a-1']).toEqual([{ kind: 'five_hour', percentUsed: 40, resetsAt: RESET_5H }])

  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })
  for await (const _ of step) { /* drained */ }
  await step.result
  await clock.advance(2000)
  expect(await text()).toBe('bob@example* | Opus 5.5 Medium | H 15% (27m 13s) | W 70% (6d 19h) | 2s ago')

  await login(ana)
  expect(await text()).toBe('ana.longna*@example* | Opus 5.5 Medium | H 40% (27m 11s)')
})
