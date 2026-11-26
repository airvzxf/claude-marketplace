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

## Releases

Claude Code takes updates from the `version` in each plugin's `plugin.json` and in `.claude-plugin/marketplace.json`, not from tags: bump both together (CI checks they match). Each release is also a signed tag, `<plugin>-vX.Y.Z`, on the merge commit in `main`:

```
git fetch origin
git tag -s usage-line-v0.2.0 -m 'release: usage-line 0.2.0' origin/main
git push origin usage-line-v0.2.0
```

The `release` workflow checks that the tag is on `main`, that it is signed by a key in `.github/trusted-signers` and that both manifests carry its version, then publishes a GitHub release with the plugin as `.zip` and `.tar.gz` and their `SHA256SUMS`.
