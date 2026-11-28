"""Unit tests for tools/claude-usage/claude-usage (stdlib only; needs bash and jq).

The script only runs main() when executed, so each test sources it in bash,
replaces the clock (now_epoch) and the systemd side (schedule_event), and
calls one function. Everything happens in a throwaway HOME, in UTC.
Run from the repository root:  python3 -m unittest discover -s tests -v
"""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "tools/claude-usage/claude-usage"

NOW = 1_800_000_000          # the fake clock
HOUR = 3600
LEAD = 120                   # CLAUDE_USAGE_CLOSE_LEAD_S default
MARGIN = 5 * 60              # CLAUDE_USAGE_MARGIN_MIN default, in seconds


class UsageCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name)
        self.data = self.home / "data"
        self.conf = self.home / "accounts"

    def bash(self, body, now=NOW, check=True):
        """Source the script, fake the clock, select account 'a', run body."""
        prelude = f"""
            source {SCRIPT}
            now_epoch() {{ printf '%s' {now}; }}
            schedule_event() {{ printf '%s %s\\n' "$1" "$2"; }}
            require_cmd() {{ :; }}
            select_account a claude
        """
        env = {"HOME": str(self.home), "PATH": "/usr/bin:/bin", "TZ": "UTC", "LC_ALL": "C",
               "CLAUDE_USAGE_DIR": str(self.data), "CLAUDE_USAGE_CONF": str(self.conf)}
        r = subprocess.run(["bash", "-c", prelude + body], env=env,
                           capture_output=True, text=True, timeout=30)
        if check:
            self.assertEqual(r.returncode, 0, r.stderr)
        return r

    def out(self, body, **kw):
        return self.bash(body, **kw).stdout

    def write_state(self, **state):
        (self.data / "a").mkdir(parents=True, exist_ok=True)
        (self.data / "a" / "window.json").write_text(json.dumps(state))

    def write_history(self, *rows):
        (self.data / "a").mkdir(parents=True, exist_ok=True)
        (self.data / "a" / "usage.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))

    def state(self):
        return json.loads((self.data / "a" / "window.json").read_text())


class Formatting(UsageCase):
    def test_fmt_duration(self):
        cases = {-5: "00s", 0: "00s", 59: "59s", 61: "01m 01s", 3_661: "1h 01m 01s",
                 90_061: "1d 01h 01m 01s"}
        for secs, want in cases.items():
            self.assertEqual(self.out(f"fmt_duration {secs}"), want, secs)

    def test_fmt_duration_short(self):
        cases = {-5: "0s", 42: "42s", 600: "10m", 3_900: "1h 05m", 97_200: "1d 3h"}
        for secs, want in cases.items():
            self.assertEqual(self.out(f"fmt_duration_short {secs}"), want, secs)

    def test_fmt_pct_drops_the_sign_at_100(self):
        self.assertEqual(self.out("fmt_pct 42"), "42%")
        self.assertEqual(self.out("fmt_pct 100"), "100")

    def test_to_epoch_rounds_to_the_minute(self):
        # 2027-01-15T10:00:29Z rounds down, :30 rounds up.
        self.assertEqual(self.out("to_epoch 2027-01-15T10:00:29Z"), "1800007200")
        self.assertEqual(self.out("to_epoch 2027-01-15T10:00:30Z"), "1800007260")
        self.assertEqual(self.out("to_epoch null"), "0")
        self.assertEqual(self.out("to_epoch ''"), "0")


class Snapshot(UsageCase):
    def test_build_snapshot_flattens_the_api_reply(self):
        reply = {"five_hour": {"utilization": 41.7, "resets_at": "2027-01-15T10:00:00Z"},
                 "seven_day": {"utilization": 12.2, "resets_at": "2027-01-20T00:00:00Z"}}
        snap = json.loads(self.out(f"build_snapshot '{json.dumps(reply)}' 'when' {NOW} manual"))
        self.assertEqual(snap, {
            "logged_at": "when", "ts": NOW, "event": "manual",
            "five_hour_used_percent": 41, "five_hour_resets_at": NOW + 2 * HOUR,
            "weekly_used_percent": 12, "weekly_resets_at": 1800403200})

    def test_build_snapshot_without_a_window(self):
        reply = {"five_hour": None, "seven_day": {"utilization": 3, "resets_at": None}}
        snap = json.loads(self.out(f"build_snapshot '{json.dumps(reply)}' w {NOW} check"))
        self.assertEqual((snap["five_hour_used_percent"], snap["five_hour_resets_at"],
                          snap["weekly_used_percent"], snap["weekly_resets_at"]), (0, 0, 3, 0))

    def test_history_row(self):
        row = {"logged_at": "2027-01-15 08:00:00", "ts": NOW, "event": "open",
               "five_hour_used_percent": 25, "five_hour_resets_at": NOW + 2 * HOUR,
               "weekly_used_percent": 100, "weekly_resets_at": NOW + 86_400}
        cols = [c.strip() for c in self.out(f"render_history_row '{json.dumps(row)}'").split("|")]
        self.assertEqual(cols, ["2027-01-15 08:00:00", "2h 00m 00s", "75%",
                                "1d 00h 00m 00s", "0%", "open"])

    def test_history_row_with_an_ended_window(self):
        row = {"logged_at": "x", "ts": NOW, "five_hour_used_percent": 80,
               "five_hour_resets_at": NOW - 1, "weekly_used_percent": 0, "weekly_resets_at": NOW}
        cols = [c.strip() for c in self.out(f"render_history_row '{json.dumps(row)}'").split("|")]
        self.assertEqual(cols[1:3], ["inactive", "100"])
        self.assertEqual(cols[5], "-")

    def test_history_row_skips_garbage(self):
        self.assertEqual(self.out("render_history_row 'not json'"), "")
        self.assertEqual(self.out("render_history_row '{}'"), "")


class WindowState(UsageCase):
    READ = 'read_window_state; echo "$WIN_RESET $WIN_WEEK_RESET $WIN_SOURCE $WIN_CLOSED_FOR $WIN_WEEK_CLOSED_FOR $WIN_WEEK_USED"'

    def test_nothing_stored(self):
        self.assertEqual(self.out(self.READ).split(), ["0", "0", "0", "0", "0"])

    def test_from_window_json(self):
        self.write_state(resets_at=NOW + HOUR, weekly_resets_at=NOW + 9 * HOUR, source="api",
                         closed_for=NOW - 4 * HOUR, week_closed_for=0, weekly_used_percent=55)
        self.assertEqual(self.out(self.READ).split(),
                         [str(NOW + HOUR), str(NOW + 9 * HOUR), "api", str(NOW - 4 * HOUR), "0", "55"])

    def test_falls_back_to_the_last_history_row(self):
        self.write_history({"five_hour_resets_at": 1, "weekly_resets_at": 2},
                           {"five_hour_resets_at": NOW + 60, "weekly_resets_at": NOW + 600,
                            "weekly_used_percent": 7})
        self.assertEqual(self.out(self.READ).split(),
                         [str(NOW + 60), str(NOW + 600), "history", "0", "0", "7"])

    def test_bad_values_become_zero(self):
        self.write_state(resets_at="soon", weekly_resets_at=-3, weekly_used_percent=12.5)
        self.assertEqual(self.out(self.READ).split(), ["0", "0", "0", "0", "0"])

    def test_is_closed_tolerates_five_minutes(self):
        r = NOW
        for marker, want in ((r, 0), (r + 299, 0), (r - 299, 0), (r + 300, 1), (r - 300, 1), (0, 1)):
            rc = self.bash(f"is_closed {marker} {r}", check=False).returncode
            self.assertEqual(rc, want, marker - r)

    def test_week_blocked(self):
        def blocked(used, reset):
            self.write_state(weekly_used_percent=used, weekly_resets_at=reset)
            return self.bash("read_window_state; week_blocked", check=False).returncode == 0
        self.assertTrue(blocked(100, NOW + HOUR))
        self.assertTrue(blocked(100, NOW - MARGIN + 1))   # still inside the margin after the reset
        self.assertFalse(blocked(100, NOW - MARGIN))
        self.assertFalse(blocked(99, NOW + HOUR))

    def test_save_state_from_snapshot_keeps_the_close_markers(self):
        self.write_state(resets_at=1, closed_for=111, week_closed_for=222)
        snap = {"ts": NOW, "five_hour_resets_at": NOW + HOUR,
                "weekly_resets_at": NOW + 50 * HOUR, "weekly_used_percent": 30}
        self.bash(f"save_state_from_snapshot '{json.dumps(snap)}'")
        st = self.state()
        self.assertEqual((st["resets_at"], st["weekly_resets_at"], st["source"],
                          st["weekly_used_percent"], st["closed_for"], st["week_closed_for"]),
                         (NOW + HOUR, NOW + 50 * HOUR, "api", 30, 111, 222))

    def test_save_state_without_a_window_only_updates_the_week(self):
        self.write_state(resets_at=NOW - HOUR, source="estimated")
        snap = {"ts": NOW, "five_hour_resets_at": 0,
                "weekly_resets_at": NOW + 50 * HOUR, "weekly_used_percent": 31}
        self.bash(f"save_state_from_snapshot '{json.dumps(snap)}'")
        st = self.state()
        self.assertEqual((st["resets_at"], st["source"], st["weekly_used_percent"]),
                         (NOW - HOUR, "estimated", 31))

    def test_mark_closed(self):
        self.write_state(resets_at=5)
        self.bash(f"mark_closed closed_for {NOW}")
        self.assertEqual(self.state(), {"resets_at": 5, "closed_for": NOW})


class ScheduleNext(UsageCase):
    def next_event(self, **state):
        self.write_state(**state)
        at, label = self.out("read_window_state; schedule_next").split()
        return int(at), label

    def test_close_before_the_window_ends(self):
        self.assertEqual(self.next_event(resets_at=NOW + HOUR, weekly_resets_at=NOW + 100 * HOUR),
                         (NOW + HOUR - LEAD, "close"))

    def test_ping_once_the_close_is_recorded(self):
        self.assertEqual(self.next_event(resets_at=NOW + HOUR, closed_for=NOW + HOUR + 60,
                                         weekly_resets_at=NOW + 100 * HOUR),
                         (NOW + HOUR + MARGIN, "ping"))

    def test_ping_inside_the_close_lead(self):
        self.assertEqual(self.next_event(resets_at=NOW + LEAD - 1, weekly_resets_at=NOW + 100 * HOUR),
                         (NOW + LEAD - 1 + MARGIN, "ping"))

    def test_week_close_comes_first(self):
        self.assertEqual(self.next_event(resets_at=NOW + 3 * HOUR, weekly_resets_at=NOW + HOUR),
                         (NOW + HOUR - LEAD, "week-close"))

    def test_week_close_already_recorded(self):
        self.assertEqual(self.next_event(resets_at=NOW + 3 * HOUR, weekly_resets_at=NOW + HOUR,
                                         week_closed_for=NOW + HOUR),
                         (NOW + 3 * HOUR - LEAD, "close"))

    def test_week_exhausted_waits_for_the_reset(self):
        self.assertEqual(self.next_event(resets_at=NOW + HOUR, weekly_resets_at=NOW + 30 * HOUR,
                                         weekly_used_percent=100, week_closed_for=NOW + 30 * HOUR),
                         (NOW + 30 * HOUR + MARGIN, "ping"))


class Accounts(UsageCase):
    def accounts(self):
        return self.bash('load_accounts; printf "%s\\n" "${ACCOUNTS[@]}"', check=False)

    def test_reads_names_and_providers(self):
        self.conf.write_text("# mine\nwork claude\n\n  home  agy  extra words\n")
        r = self.accounts()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.split(), ["work:claude", "home:agy"])

    def test_rejects_bad_lines(self):
        for line, err in (("work openai", "provider must be claude or agy"),
                          ("../x claude", "invalid account name"),
                          ("# only a comment", "no accounts")):
            self.conf.write_text(line + "\n")
            r = self.accounts()
            self.assertEqual(r.returncode, 64, line)
            self.assertIn(err, r.stderr)

    def test_missing_list(self):
        r = self.accounts()
        self.assertEqual(r.returncode, 64)
        self.assertIn("no account list", r.stderr)


if __name__ == "__main__":
    unittest.main()
