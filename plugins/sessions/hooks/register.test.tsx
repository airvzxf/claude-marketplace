import { expect, test } from 'claude-code/testing'

test('/sessions runs the bundled script and shows its output only to the person', async ($, on) => {
  const calls: { argv: readonly string[]; columns?: string }[] = []
  on('process.run', (_, e) => {
    calls.push({ argv: e.argv, columns: e.init?.env?.COLUMNS })
    return { value: { exitCode: 0, stdout: 'Claude sessions · 2 open\n', stderr: '' } }
  })
  on('command.register', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const result = await $.command.run({ command: 'sessions', args: '-s --offline' })
  expect(result.text).toBe('Claude sessions · 2 open')
  expect(calls.length).toBe(1)
  expect(calls[0].argv.slice(0, 1)).toEqual(['python3'])
  expect(calls[0].argv[1].endsWith('/bin/claude-sessions')).toBe(true)
  expect(calls[0].argv.slice(2)).toEqual(['--color', 'never', '-s', '--offline'])
  expect(calls[0].columns).toBe('120') // no terminal measured in a test
})

test('/sessions names an unknown option instead of ignoring it, and runs nothing', async ($, on) => {
  let ran = false
  on('process.run', () => {
    ran = true
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('command.register', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const result = await $.command.run({ command: 'sessions', args: '--ofline' })
  expect(result.text).toBe('Unknown option --ofline. Use: -s | --short, -l | --long, --project, --offline')
  expect(ran).toBe(false)
})
