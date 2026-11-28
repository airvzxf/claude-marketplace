# claude-marketplace

Claude Code plugins and mods by Israel Roldan.

```
/plugin marketplace add airvzxf/claude-marketplace
```

## usage-line

Everything you need to keep an eye on, in one line at the bottom right, beside the permission mode (or right above the prompt when that row has no room): the account signed in, the model and its effort, the context window fill, the subscription's 5-hour and weekly windows, and how long ago those windows were read.

```
someone.lo*@example* | Opus 5.5 Xhigh | C 3% (29k/1m) | H 92% (3h 7m) | W 66% (5d 19h) | 1h 35m ago
```

- **Account**: the login Claude Code holds on disk (`~/.claude.json`), read again whenever that file changes. Claude Code sends each request under the login on disk at the time, so when another login takes its place, even with sessions open, the line names the new account within two seconds and shows that account's windows, never the previous one's. The `account` option picks how it reads: `short` (the default) keeps the start of the name and of the domain, `full` the whole address, `none` leaves it out.
- **Model and effort**: the effort the session is at now. `/effort max` shows `Max` at once, saved or for the session only; each request then shows the effort it went out at.
- **C, context**: percentage used, then tokens used / window size.
- **H and W, the 5-hour and weekly windows**: percentage used, then the time until they reset: `5d 19h`, `8h 59m`, then `20m 5s` and `59s` counting down by the second in the last hour. `N/A` when the window is not open: it closed at its reset, and the next request opens a new one.
- **Age**: how long ago a response last reported the account's windows, in this session or any other: `5s`, `35m 3s`, `1h 35m`, `2d 4h`. The percentages only change with a response, so a session left alone shows them as they were, and this says how old they are.

Each account keeps its own windows: a response counts toward the account it was sent under, and sessions share what they read for each account. Right after a change of login, the line shows what was last read for that account (or what its login record kept) until its first response.

The numbers are white: the age, and each percentage until it turns yellow from 50%, orange from 75% and red from 90%. The account, `H`, `W` and `ago`, what belongs to the account and is shared across sessions, are a dim rose, so they read as one group. The separators, the effort, `C` and the details in parentheses stay in a light gray so the numbers stand out.

```
/plugin install usage-line --marketplace airvzxf/claude-marketplace
```

## sessions

`/sessions` lists every Claude Code session open on this machine, the one you type in marked with `▶`: whether it waits for you, works, has only background work left (a blue `●`, listed right under the busy ones) or idles, its name and title, the account it runs under, the model and effort, the version (and whether it needs a restart to reach the newest one installed), running shells, background tasks and agents, an open pull request and the folder. A header counts them and says when a newer Claude Code is released.

```
Claude sessions · 3 open · 1 waiting · 1 busy · 1 idle · account work · v2.1.332
  ◆ waiting (input needed) api-3f Fix the retry loop                       41210 9b1c02aa   2m
    ~/projects/api · Opus 5.5 high · work · 2.1.332 · bg 1
▶ ● busy docs-7a Rewrite the install guide                                 51877 d4e5f6a7   5s
    ~/projects/docs · Sonnet 5.5 medium · personal · 2.1.332 · running cmd
```

- `/sessions -s`: one line per session (status, name and title, folder, age).
- `/sessions -l`: a third line with the session's summary, or the last prompt (`»`).
- `/sessions --project`: only the sessions in this folder or below.
- `/sessions --offline`: never ask the release server; the header says `offline`.

The output shows only to you: it costs the model no context. The work is done by `bin/claude-sessions` (Python 3, standard library only), which reads `~/.claude/sessions/`, the transcripts and the processes; nothing leaves the machine but the release check, at most every 6 hours, in the background. To use it in a terminal too, link it into your `PATH` from a clone of this repository (`--json` and `--watch N` are there as well):

```
ln -s "$PWD/plugins/sessions/bin/claude-sessions" ~/.local/bin/claude-sessions
```

```
/plugin install sessions --marketplace airvzxf/claude-marketplace
```

## Command-line tools

Standalone commands in `tools/`, not plugins: link them into your `PATH` from a clone (`ln -s "$PWD/tools/<tool>/<tool>" ~/.local/bin/`).

- **`claude-account`** (bash, `jq`, `curl`): keeps several Claude Code logins on one machine and swaps between them without the browser. Only the login (`~/.claude/.credentials.json`) and the account keys of `~/.claude.json` are swapped; settings, plugins, memory and sessions stay shared. `save <name>`, `use <name|auto>` (`auto` picks the login with the most room left), `list` (with each login's open sessions when `claude-sessions` is in your `PATH`), `whoami`, `usage [name]`, `--version`. Saved logins are kept in `~/.local/share/claude-accounts/`, readable only by you. Open sessions re-read the login from disk, so a switch moves every open session to the new account.
- **`claude-usage`** (bash, `jq`, `curl`, `flock`; Podman for logins that are not active; `notify-send` for `--notify`): tracks the 5-hour window and the weekly limit of each account saved with `claude-account` (and Antigravity through `agy`), keeps a history, and with `--keepalive` (the systemd user units in `tools/claude-usage/systemd/`) records each window as it closes and sends a minimal prompt after it ends to open the next one. `claude-usage --help` has the details.

## License

[AGPL-3.0-or-later](LICENSE).

## Releases

Claude Code takes updates from the `version` in each plugin's `plugin.json` and in `.claude-plugin/marketplace.json`, not from tags: bump both together (CI checks they match). For `sessions`, also bump `VERSION` in `plugins/sessions/bin/claude-sessions`: the unit tests (`python3 -m unittest discover -s tests`, which also run `claude-account` and `claude-usage` in a throwaway `HOME`) check it matches. Each release is also a signed tag, `<plugin>-vX.Y.Z`, on the merge commit in `main`:

```
git fetch origin
git tag -s usage-line-v0.2.0 -m 'release: usage-line 0.2.0' origin/main
git push origin usage-line-v0.2.0
```

The `release` workflow checks that the tag is on `main`, that it is signed by a key in `.github/trusted-signers` and that both manifests carry its version, then publishes a GitHub release with the plugin as `.zip` and `.tar.gz` and their `SHA256SUMS`.
