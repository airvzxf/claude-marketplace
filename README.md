# claude-marketplace

Claude Code plugins and mods by Israel Roldan.

```
/plugin marketplace add airvzxf/claude-marketplace
```

## usage-line

Everything you need to keep an eye on, in one line at the bottom right, beside the permission mode (or right above the prompt when that row has no room): the model, the context window fill and the subscription's 5-hour and weekly windows.

```
Opus 5.5 | 3% (29k/1m) | 92% (3h 7m) | 66% (5d 19h)
```

- **Context**: percentage used, then tokens used / window size.
- **5-hour and weekly windows**: percentage used, then the time until they reset: `5d 19h`, `8h 59m`, then `20m 5s` and `59s` counting down by the second in the last hour.

Each percentage is white, yellow from 50%, orange from 75% and red from 90%. The separators and the details in parentheses stay in a light gray so the percentages stand out.

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
