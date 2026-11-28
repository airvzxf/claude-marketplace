"""Smoke tests for the shell tools in tools/ (stdlib only; needs bash and jq).

Each test runs the script in a throwaway HOME, so no real login is read.
Run from the repository root:  python3 -m unittest discover -s tests -v
"""
import json
import os
import re
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ACCOUNT = ROOT / "tools/claude-account/claude-account"
USAGE = ROOT / "tools/claude-usage/claude-usage"

# Sessions a fake claude-sessions reports: two under "work", one unknown.
FAKE_SESSIONS = {"sessions": [{"account": "work"}, {"account": "work"}, {"account": None}]}


class Sandbox:
    """A temporary HOME, with an optional fake claude-sessions on PATH."""

    def __init__(self, sessions=None):
        self.dir = tempfile.TemporaryDirectory()
        self.home = Path(self.dir.name)
        self.bin = self.home / "bin"
        self.bin.mkdir()
        if sessions is not None:
            fake = self.bin / "claude-sessions"
            fake.write_text("#!/bin/sh\ncat <<'EOF'\n%s\nEOF\n" % json.dumps(sessions))
            fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
        # Only the system tools: a real claude-sessions in ~/.local/bin must not leak in.
        self.path = f"{self.bin}:/usr/bin:/bin"

    def run(self, script, *args):
        env = {"HOME": str(self.home), "PATH": self.path, "LC_ALL": "C"}
        return subprocess.run(["bash", str(script), *args], env=env,
                              capture_output=True, text=True, timeout=30)

    def save_login(self, name, email):
        """Write a saved login and make it the active one."""
        account = {"oauthAccount": {"emailAddress": email}}
        (self.home / ".claude.json").write_text(json.dumps(account))
        creds = self.home / ".claude"
        creds.mkdir(exist_ok=True)
        (creds / ".credentials.json").write_text(json.dumps({"claudeAiOauth": {"expiresAt": 0}}))
        store = self.home / ".local/share/claude-accounts" / name
        store.mkdir(parents=True)
        (store / "account.json").write_text(json.dumps(account))
        (store / "oauth.json").write_text(json.dumps({"expiresAt": 0}))
        (store / "saved-at").write_text("2026-01-01T00:00:00+00:00\n")

    def close(self):
        self.dir.cleanup()


class ToolCase(unittest.TestCase):
    sessions = None

    def setUp(self):
        self.box = Sandbox(self.sessions)
        self.addCleanup(self.box.close)


class ClaudeAccountCommands(ToolCase):
    def test_version(self):
        r = self.box.run(ACCOUNT, "--version")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertRegex(r.stdout.strip(), r"^claude-account \d+\.\d+\.\d+$")

    def test_help_succeeds(self):
        for flag in ("--help", "-h", "help"):
            r = self.box.run(ACCOUNT, flag)
            self.assertEqual(r.returncode, 0, flag)
            self.assertIn("claude-account save <name>", r.stdout)

    def test_no_command_prints_help_and_fails(self):
        r = self.box.run(ACCOUNT)
        self.assertEqual(r.returncode, 1)
        self.assertIn("claude-account use <name>", r.stdout)

    def test_unknown_command_fails(self):
        r = self.box.run(ACCOUNT, "bogus")
        self.assertEqual(r.returncode, 1)
        self.assertIn("unknown command: bogus", r.stderr)

    def test_use_needs_a_name(self):
        r = self.box.run(ACCOUNT, "use")
        self.assertEqual(r.returncode, 1)
        self.assertIn("usage: claude-account use <name>", r.stderr)

    def test_invalid_name_is_refused(self):
        r = self.box.run(ACCOUNT, "save", "../x")
        self.assertEqual(r.returncode, 1)
        self.assertIn("invalid name", r.stderr)

    def test_list_without_claude_sessions(self):
        self.box.save_login("work", "a@example.com")
        r = self.box.run(ACCOUNT, "list")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertRegex(r.stdout, r"^\* work\s+a@example\.com")
        self.assertNotIn("open session", r.stdout)


class ClaudeAccountWithSessions(ToolCase):
    sessions = FAKE_SESSIONS

    def test_list_counts_sessions_per_login(self):
        self.box.save_login("work", "a@example.com")
        r = self.box.run(ACCOUNT, "list")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("2 open sessions", r.stdout)
        self.assertIn("(1 open session of an account that is not saved)", r.stdout)


class ClaudeUsageCommands(ToolCase):
    def test_version_matches_script(self):
        want = re.search(r'VERSION="([^"]+)"', USAGE.read_text()).group(1)
        r = self.box.run(USAGE, "--version")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), f"claude-usage {want}")

    def test_help_succeeds(self):
        r = self.box.run(USAGE, "--help")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("--keepalive", r.stdout)

    def test_unknown_option_fails(self):
        r = self.box.run(USAGE, "--bogus")
        self.assertNotEqual(r.returncode, 0)
        # Nothing is written to HOME before the options are read.
        self.assertEqual(sorted(p.name for p in self.box.home.iterdir()), ["bin"])


if __name__ == "__main__":
    unittest.main()
