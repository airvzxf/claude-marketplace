"""Tests for .github/release-notes.sh in a throwaway git repository.

Run from the repository root:  python3 -m unittest discover -s tests -v
"""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NOTES = ROOT / ".github/release-notes.sh"
REPO = "owner/repo"


class ReleaseNotes(unittest.TestCase):
    """Two components, `alpha` (plugins/alpha) and `beta` (tools/beta), whose
    tags interleave on one history, like the plugins and tools of this repo."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.env = {
            "PATH": os.environ["PATH"], "HOME": str(self.dir), "LC_ALL": "C",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
            "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid",
        }
        self.git("init", "-q", "-b", "main")
        self.commit("plugins/alpha/a", "feat(alpha): first (#1)")
        self.commit("tools/beta/b", "feat(beta): first (#2)")
        self.tag("alpha-v1.0.0")
        self.commit("tools/beta/b", "fix(beta): second (#3)")
        self.tag("beta-v1.0.0")
        self.commit("plugins/alpha/a", "fix(alpha): second (#4)")
        self.commit("README", "docs: readme only (#5)")
        self.tag("alpha-v1.1.0")
        self.tag("beta-v1.0.1")  # same commit, nothing new in tools/beta

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.dir, env=self.env,
                              check=True, capture_output=True, text=True).stdout

    def commit(self, path, subject):
        f = self.dir / path
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(f.read_text() + subject + "\n" if f.exists() else subject + "\n")
        self.git("add", path)
        self.git("commit", "-q", "-m", subject)

    def tag(self, name):
        self.git("tag", "-a", name, "-m", name)

    def notes(self, tag, name, source):
        return subprocess.run(["bash", str(NOTES), tag, name, source, REPO], cwd=self.dir,
                              env=self.env, check=True, capture_output=True, text=True).stdout

    def test_first_release_lists_its_folder_from_the_start(self):
        out = self.notes("beta-v1.0.0", "beta", "tools/beta")
        self.assertIn("* fix(beta): second (#3)", out)
        self.assertIn("* feat(beta): first (#2)", out)
        self.assertNotIn("alpha", out)
        self.assertIn(f"https://github.com/{REPO}/commits/beta-v1.0.0/tools/beta", out)

    def test_next_release_starts_at_its_own_previous_tag(self):
        out = self.notes("alpha-v1.1.0", "alpha", "plugins/alpha")
        self.assertIn("* fix(alpha): second (#4)", out)
        self.assertNotIn("first (#1)", out)  # in alpha-v1.0.0
        self.assertNotIn("beta", out)        # the beta tag in between is skipped
        self.assertNotIn("readme", out)      # outside plugins/alpha
        self.assertIn(f"https://github.com/{REPO}/compare/alpha-v1.0.0...alpha-v1.1.0", out)

    def test_release_without_changes_in_its_folder(self):
        out = self.notes("beta-v1.0.1", "beta", "tools/beta")
        self.assertIn("No changes in `tools/beta`.", out)
        self.assertIn(f"https://github.com/{REPO}/compare/beta-v1.0.0...beta-v1.0.1", out)


if __name__ == "__main__":
    unittest.main()
