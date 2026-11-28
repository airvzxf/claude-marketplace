import type { Register } from 'claude-code'

// A thin layer over the `claude-sessions` command the plugin ships in `bin/`:
// the command does the work, the mod runs it and shows its output. The output
// is for the person alone, so it costs the model no context.
export const OPTIONS = ['-s', '--short', '-l', '--long', '--project', '--offline'] as const
const KNOWN = new Set<string>(OPTIONS)
const USAGE = 'Use: -s | --short, -l | --long, --project, --offline'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sessions',
      description: 'List every open Claude Code session (-s: one line each, -l: add summaries, --project: this folder only, --offline)',
    })
    return next(e)
  })

  on('command.run', { command: 'sessions' }, async ($, e) => {
    const args = e.args.split(/\s+/).filter(Boolean)
    const unknown = args.filter(a => !KNOWN.has(a))
    if (unknown.length) {
      return { text: `Unknown option ${unknown.join(' ')}. ${USAGE}`, isTextDisplayOnly: true }
    }
    const script = `${$.plugin.root}/bin/claude-sessions`
    // `presentation.columns` is the whole terminal, but the transcript draws
    // a command's output behind a gutter (`  ⎿  `, 5 cells): leave it that
    // much and one cell more, so no row fills the last column and wraps.
    // Where nothing measured a terminal (a test, some hosts), draw 120 columns.
    const columns = String(Math.max(60, (e.presentation?.columns ?? 126) - 6))
    try {
      const { exitCode, stdout, stderr } = await $.process.run(
        ['python3', script, '--color', 'never', ...args],
        // The time it was asked lets the script tell this run's own busy
        // state from real work, and show this session idle as it will be.
        { timeoutMs: 15000, env: { COLUMNS: columns, CLAUDE_SESSIONS_COMMAND_AT: String(Date.now()) } },
      )
      const text = exitCode === 0 ? stdout.trimEnd() : `claude-sessions failed (${exitCode}): ${stderr.trim()}`
      return { text, isTextDisplayOnly: true }
    } catch (err) {
      return { text: `Could not run claude-sessions: ${String(err)}. Is python3 on PATH?`, isTextDisplayOnly: true }
    }
  })
}
