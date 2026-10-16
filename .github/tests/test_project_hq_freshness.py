"""Regression checks for advisory Actions and the strict agent completion gate."""
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/check_project_hq_freshness.py"

class FreshnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Freshness test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        (self.root / "README.md").write_text("Baseline\n", encoding="utf-8")
        self.commit()
        self.baseline = self.git("rev-parse", "HEAD").stdout.strip()
        self.status(self.baseline)

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root, check=True,
                              capture_output=True, text=True)

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-qm", "Synthetic test commit")

    def status(self, sha):
        path = self.root / ".project/STATUS.yaml"
        path.parent.mkdir(exist_ok=True)
        path.write_text(f'schema_version: 1\nsource:\n  commit: "{sha}"\n', encoding="utf-8")

    def run_check(self, *args):
        env = {**os.environ, "GITHUB_STEP_SUMMARY": str(self.root / ".git/step-summary.txt")}
        return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=self.root,
                              capture_output=True, text=True, env=env)

    def change_code(self):
        (self.root / "app.py").write_text("changed\n", encoding="utf-8")
        self.commit()

    def test_fresh_default_and_strict_pass(self):
        for args in [(), ("--strict",)]:
            result = self.run_check(*args)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertNotIn("::warning::", result.stdout)
            self.assertNotIn("::error::", result.stdout)

    def test_report_only_commits_remain_fresh(self):
        self.commit()
        self.assertEqual(self.run_check("--strict").returncode, 0)

    def test_stale_default_warns_without_failing_actions(self):
        self.change_code()
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("::warning::", result.stdout)
        self.assertIn("app.py", result.stdout)
        self.assertNotIn("::error::", result.stdout)
        self.assertIn("may be stale", (self.root / ".git/step-summary.txt").read_text(encoding="utf-8"))

    def test_strict_stale_fails_without_hiding_the_warning(self):
        self.change_code()
        result = self.run_check("--strict")
        self.assertEqual(result.returncode, 1)
        self.assertIn("::warning::", result.stdout)

    def test_reviewed_source_recovers_without_timestamp_loop(self):
        self.change_code()
        self.assertEqual(self.run_check("--strict").returncode, 1)
        reviewed = self.git("rev-parse", "HEAD").stdout.strip()
        self.status(reviewed)
        self.commit()
        self.assertEqual(self.run_check("--strict").returncode, 0)

    def test_missing_report_fails_both_modes(self):
        (self.root / ".project/STATUS.yaml").unlink()
        for args in [(), ("--strict",)]:
            result = self.run_check(*args)
            self.assertEqual(result.returncode, 1)
            self.assertIn("::error::Missing", result.stdout)

    def test_invalid_source_fails_both_modes(self):
        self.status("not-a-sha")
        for args in [(), ("--strict",)]:
            result = self.run_check(*args)
            self.assertEqual(result.returncode, 1)
            self.assertIn("::error::Missing or invalid", result.stdout)

    def test_unknown_source_remains_a_failure(self):
        self.status("f" * 40)
        result = self.run_check()
        self.assertEqual(result.returncode, 1)
        self.assertIn("::error::", result.stdout)

    def test_nonancestor_source_remains_a_failure(self):
        self.change_code()
        future = self.git("rev-parse", "HEAD").stdout.strip()
        self.git("checkout", "-q", self.baseline)
        self.status(future)
        result = self.run_check()
        self.assertEqual(result.returncode, 1)
        self.assertIn("not an ancestor", result.stdout)

    def test_reverted_work_still_warns(self):
        self.change_code()
        (self.root / "app.py").unlink()
        self.commit()
        self.assertIn("::warning::", self.run_check().stdout)

    def test_excluded_agent_maintenance_remains_fresh(self):
        (self.root / "AGENTS.md").write_text("Maintenance\n", encoding="utf-8")
        self.commit()
        self.assertEqual(self.run_check("--strict").returncode, 0)

    def test_bad_cli_arguments_are_not_silenced(self):
        self.assertEqual(self.run_check("--unknown-option").returncode, 2)

if __name__ == "__main__":
    unittest.main()
