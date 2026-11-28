"""Unit tests for plugins/sessions/bin/claude-sessions (stdlib only).

Run from the repository root:  python3 -m unittest discover -s tests -v
"""
import importlib.machinery
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "plugins/sessions/bin/claude-sessions"

_loader = importlib.machinery.SourceFileLoader("claude_sessions", str(SCRIPT))
_spec = importlib.util.spec_from_loader("claude_sessions", _loader)
cs = importlib.util.module_from_spec(_spec)
_loader.exec_module(cs)

# PIDs no real process has, so the /proc lookups find nothing.
P = 4_000_000_000


def row(**kw):
    base = {"status": "idle", "current": False, "status_since": 100.0,
            "background": 0, "agents_running": 0, "foreground": 0}
    base.update(kw)
    return base


class ShownStatus(unittest.TestCase):
    def test_known_statuses_pass_through(self):
        for st in ("waiting", "busy", "idle"):
            self.assertEqual(cs.shown_status(row(status=st), 0), st)

    def test_unknown_status_is_background(self):
        self.assertEqual(cs.shown_status(row(status="shell"), 0), "background")

    def test_idle_with_work_is_background(self):
        for key in ("background", "agents_running", "foreground"):
            self.assertEqual(cs.shown_status(row(**{key: 1}), 0), "background", key)

    def test_own_command_makes_current_session_idle(self):
        x = row(status="busy", current=True, status_since=99.0)
        self.assertEqual(cs.shown_status(x, 100.0), "idle")   # within the 2 s slack

    def test_busy_before_the_command_stays_busy(self):
        x = row(status="busy", current=True, status_since=90.0)
        self.assertEqual(cs.shown_status(x, 100.0), "busy")

    def test_other_sessions_and_plain_runs_stay_busy(self):
        self.assertEqual(cs.shown_status(row(status="busy", status_since=100.0), 100.0), "busy")
        self.assertEqual(cs.shown_status(row(status="busy", current=True), 0), "busy")

    def test_self_idle_with_background_work_is_background(self):
        x = row(status="busy", current=True, status_since=100.0, background=1)
        self.assertEqual(cs.shown_status(x, 100.0), "background")


class ProcSummary(unittest.TestCase):
    def setUp(self):
        self.claude = P
        self.table = {
            P: (1, "claude", "0"),
            P + 1: (P, "zsh", "0"),        # a Bash call
            P + 2: (P, "node", "0"),       # a helper (MCP server, LSP, ...)
            P + 3: (P + 1, "sleep", "0"),  # grandchild: not counted on its own
        }
        cs.OWN_CHAIN.clear()

    def tearDown(self):
        cs.OWN_CHAIN.clear()

    def test_busy_shell_is_foreground(self):
        w = cs.proc_summary(self.table, self.claude, set(), busy=True)
        self.assertEqual((w["foreground"], w["background"]), (1, 0))
        self.assertEqual(w["helpers"], ["node"])

    def test_shell_outliving_the_turn_is_background(self):
        w = cs.proc_summary(self.table, self.claude, set(), busy=False)
        self.assertEqual((w["foreground"], w["background"]), (0, 1))
        self.assertEqual(w["background_ids"], [str(P + 1)])

    def test_own_chain_is_skipped(self):
        cs.OWN_CHAIN.add(P + 1)
        w = cs.proc_summary(self.table, self.claude, set(), busy=True)
        self.assertEqual((w["foreground"], w["background"]), (0, 0))

    def test_finished_agent_with_live_task_is_running(self):
        agents = [{"description": "done", "finished": True, "bg_ids": set()},
                  {"description": "waits", "finished": True, "bg_ids": {str(P + 1)}},
                  {"description": "works", "finished": False, "bg_ids": set()}]
        w = cs.work_summary(self.table, self.claude, set(), agents, busy=False)
        self.assertEqual((w["agents"], w["agents_running"]), (3, 2))
        self.assertEqual(w["agents_active"], ["waits", "works"])


class Parsing(unittest.TestCase):
    def test_bg_ids_from_main_and_subagent_transcripts(self):
        data = (b'{"backgroundTaskId":"abc123"}\n'
                b'Command running in background with ID: def456\n')
        self.assertEqual(cs.bg_ids_in(data), {"abc123", "def456"})

    def test_pretty_model(self):
        self.assertEqual(cs.pretty_model("claude-opus-5-5"), "Opus 5.5")
        self.assertEqual(cs.pretty_model("claude-sonnet-5-5[1m]"), "Sonnet 5.5 1M")
        self.assertEqual(cs.pretty_model("claude-haiku-5-5-20260101"), "Haiku 5.5")
        self.assertEqual(cs.pretty_model(None), "-")
        self.assertEqual(cs.pretty_model("other"), "other")

    def test_clip_keeps_display_width(self):
        self.assertEqual(cs.clip("abcdef", 4), "abc…")
        self.assertEqual(cs.dwidth(cs.clip("日本語テキスト", 6)), 5)   # no half wide char
        self.assertEqual(cs.clip_left("/a/b/project", 8), "…project")


class Version(unittest.TestCase):
    def test_script_version_matches_plugin_manifest(self):
        manifest = json.loads((ROOT / "plugins/sessions/.claude-plugin/plugin.json").read_text())
        self.assertEqual(cs.VERSION, manifest["version"])


if __name__ == "__main__":
    unittest.main()
