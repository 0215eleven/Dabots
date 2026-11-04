"""Portable updater control-flow tests. Daemons and POSIX metadata are simulated."""
import importlib.util
import json
from pathlib import Path
import shutil
import signal
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

if sys.platform == "win32":
    sys.modules.setdefault("fcntl", types.SimpleNamespace())
    if not hasattr(signal, "SIGHUP"):
        signal.SIGHUP = 1
spec = importlib.util.spec_from_file_location("updater", Path(__file__).parents[1] / "deploy/update.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Admission(unittest.TestCase):
    def test_snapshot_includes_absent_settings_and_refuses_drift(self):
        expected = m.admission_snapshot({"RELAY_ACCESS_FILE": "/state/access.json"})
        self.assertEqual(set(expected), set(m.ADMISSION_KEYS))
        self.assertEqual(expected["RELAY_SECRET_FILE"], "")
        with self.assertRaises(m.Refused):
            m.match_admission({"RELAY_SECRET_FILE": "/secret"}, expected)
        with self.assertRaises(m.Refused):
            m.admission_snapshot({"RELAY_ACCESS_FILE": ["invalid"]})

    def test_pending_compose_env_file_is_checked_before_staging(self):
        expected = m.admission_snapshot({"RELAY_ACCESS_FILE": "/state/access.json"})
        for environment in [{"RELAY_OPEN_REGISTRATION": "1", "RELAY_SECRET_FILE": "/secret"},
                            {"RELAY_SECRET_FILE": "/secret"}]:
            resolved = {"services": {"relay": {"command": ["node", "bin.mjs"], "environment": environment}}}
            with patch.object(m, "run", return_value=json.dumps(resolved)):
                with self.assertRaises(m.Refused):
                    m.compose_restart_admission(["docker", "compose"], "relay", expected)
        resolved["services"]["relay"]["environment"] = expected
        with patch.object(m, "run", return_value=json.dumps(resolved)):
            m.compose_restart_admission(["docker", "compose"], "relay", expected)
        resolved["services"]["relay"]["command"] = ["node", "legacy.mjs"]
        with patch.object(m, "run", return_value=json.dumps(resolved)):
            with self.assertRaises(m.Refused):
                m.compose_restart_admission(["docker", "compose"], "relay", expected)

    def test_systemd_pending_environment_and_entrypoint_are_checked(self):
        expected = m.admission_snapshot({"RELAY_ACCESS_FILE": "/state/access.json"})
        def run(args, **_):
            prop = args[args.index("-p") + 1]
            return {"Environment": 'RELAY_ACCESS_FILE=/state/access.json', "EnvironmentFiles": "",
                    "ExecStart": "{ path=/usr/bin/node ; argv[]=/usr/bin/node /opt/relay/bin.mjs ; ignore_errors=no ; }"}[prop]
        with patch.object(m, "run", side_effect=run):
            m.systemd_restart_admission("relay", Path("/opt/relay/bin.mjs"), expected)
        for prop, value in [("EnvironmentFiles", "/etc/relay.env (ignore_errors=no)"),
                            ("Environment", "RELAY_OPEN_REGISTRATION=1 RELAY_SECRET_FILE=/secret"),
                            ("ExecStart", "{ argv[]=/usr/bin/node /opt/relay/legacy.mjs ; }")]:
            with patch.object(m, "run", side_effect=lambda args, **kw: value if args[args.index("-p") + 1] == prop else run(args, **kw)):
                with self.assertRaises(m.Refused):
                    m.systemd_restart_admission("relay", Path("/opt/relay/bin.mjs"), expected)


class Transactions(unittest.TestCase):
    def exercise(self, kind, *, stop_fails=False, candidate_fails=True):
        with tempfile.TemporaryDirectory(prefix="relay-control-") as temporary:
            area = Path(temporary)
            base = area / "install"
            base.mkdir()
            previous = area / "releases/old"
            (previous / "relay").mkdir(parents=True)
            for directory in [base, previous / "relay"]:
                for name in m.FILES:
                    (directory / name).write_text("old " + name)
                (directory / "node_modules").mkdir()
                (directory / "node_modules/old").write_text("old dependency")
                (directory / "access.json").write_text("runtime data must survive")
            events = []
            installation = object.__new__(m.Compose if kind == "compose" else m.Systemd)
            installation.args = types.SimpleNamespace(health_attempts=1)
            installation.admission = m.admission_snapshot({"RELAY_ACCESS_FILE": "/state/access.json"})
            installation.service = "relay"
            installation.base = area if kind == "compose" else base
            installation.node = "node"
            installation.image = "sha256:fixture"
            if kind == "compose":
                installation.file = area / "compose.json"
                installation.previous = previous
                installation.original = b'{"original":true}'
                installation.file.write_bytes(installation.original)
                installation.metadata = installation.file.stat()
                installation.definition = {"volumes": [str(previous) + ":/app:ro"]}
                installation.config = {"services": {"relay": installation.definition}}
                installation.parts = [str(previous), "/app", "ro"]
                installation.index = 0
                installation.changed = False
            def prepare(directory, _install):
                build = directory / "build"
                build.mkdir()
                for name in m.FILES:
                    (build / name).write_text("candidate " + name)
                (build / "node_modules").mkdir()
                return build
            def run(args, **_):
                if args[:3] == ["cp", "-a", "--"]:
                    shutil.copytree(args[3], args[4])
                return ""
            def atomic(path, data, _metadata):
                events.append("restore" if data.startswith(b"old ") or data == b'{"original":true}' else "write")
                path.write_bytes(data)
            def stop():
                events.append("stop")
                if stop_fails:
                    raise m.Refused("simulated stop failed")
            def restart():
                events.append("restart")
                if candidate_fails:
                    raise m.Refused("simulated candidate refused policy")
            installation.stop = stop
            installation.restart = restart
            installation.healthy = lambda *_: True
            with patch.object(m, "prepare", side_effect=prepare), patch.object(m, "run", side_effect=run), \
                 patch.object(m, "copy_file", side_effect=lambda source, target, metadata=None: shutil.copy2(source, target)), \
                 patch.object(m, "atomic_bytes", side_effect=atomic), \
                 patch.object(m, "compose_restart_admission"), patch.object(m, "systemd_restart_admission"), \
                 patch.object(m.os, "chown", create=True), patch.object(m, "rollback_signals_ignored", m.contextlib.nullcontext):
                if candidate_fails or stop_fails:
                    with self.assertRaises(m.Refused):
                        installation.update()
                else:
                    installation.update()
            self.assertLessEqual(events.count("restart"), 1)
            if stop_fails:
                self.assertNotIn("restore", events)
            elif candidate_fails:
                self.assertIn("restore", events)
                self.assertLess(events.index("stop"), events.index("restore"))
                self.assertEqual((base / "server.mjs").read_text(), "old server.mjs")
                if kind == "compose":
                    self.assertEqual(installation.file.read_bytes(), installation.original)
            else:
                release = Path(installation.parts[0]) / "relay" if kind == "compose" else base
                policy = json.loads((release / "admission-policy.json").read_text())
                self.assertEqual(policy, {"version": 1, "environment": installation.admission})
                if kind == "systemd":
                    self.assertLess(events.index("stop"), events.index("restart"))
            self.assertEqual((base / "access.json").read_text(), "runtime data must survive")

    def test_compose_restores_only_after_stop_and_never_restarts_old_code(self):
        self.exercise("compose")

    def test_systemd_restores_only_after_stop_and_never_restarts_old_code(self):
        self.exercise("systemd")

    def test_compose_stop_failure_does_not_restore_legacy_configuration(self):
        self.exercise("compose", stop_fails=True)

    def test_systemd_stop_failure_does_not_replace_running_code(self):
        self.exercise("systemd", stop_fails=True)

    def test_both_successful_candidates_contain_pinned_policy(self):
        for kind in ["compose", "systemd"]:
            with self.subTest(kind=kind):
                self.exercise(kind, candidate_fails=False)


if __name__ == "__main__":
    unittest.main()
