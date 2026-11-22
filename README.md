# claude-marketplace

Claude Code plugins and mods by Israel Roldan.

```
/plugin marketplace add airvzxf/claude-marketplace
```

## usage-line

Everything you need to keep an eye on, in one line at the bottom right, beside the permission mode (or right above the prompt when that row has no room): the model and its effort, the context window fill, the subscription's 5-hour and weekly windows, and how long ago those windows were read.

```
Opus 5.5 Xhigh | C 3% (29k/1m) | H 92% (3h 7m) | W 66% (5d 19h) | 1h 35m ago
```

- **Model and effort**: the effort the session is at now. `/effort max` shows `Max` at once, saved or for the session only; each request then shows the effort it went out at.
- **C, context**: percentage used, then tokens used / window size.
- **H and W, the 5-hour and weekly windows**: percentage used, then the time until they reset: `5d 19h`, `8h 59m`, then `20m 5s` and `59s` counting down by the second in the last hour.
- **Age**: how long ago a response last reported the windows, in this session or any other: `5s`, `35m 3s`, `1h 35m`, `2d 4h`. The percentages only change with a response, so a session left alone shows them as they were, and this says how old they are.

The numbers are white: the age, and each percentage until it turns yellow from 50%, orange from 75% and red from 90%. `H`, `W` and `ago`, what the account shares across sessions, are a dim rose, so the three read as one group. The separators, the effort, `C` and the details in parentheses stay in a light gray so the numbers stand out.

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
