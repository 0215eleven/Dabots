#!/usr/bin/env python3
"""Transactional updates for an existing Relay, without changing its security settings."""
import argparse
import contextlib
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import posixpath
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
from urllib.parse import urlsplit
import uuid

FILES = ("bin.mjs", "server.mjs", "accounts.mjs", "package.json", "package-lock.json")
SOURCE = Path(__file__).resolve().parent.parent
VERSION_CHECK = "const [a,b]=process.versions.node.split('.').map(Number);if(a<22||(a===22&&b<12))process.exit(2);"
VALIDATE = "import('./server.mjs').then(()=>import('./accounts.mjs')).catch(()=>process.exit(1))"
BUILD = VERSION_CHECK + "require('node:child_process').execFileSync('npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--userconfig=/dev/null'],{stdio:'inherit'});" + VALIDATE
RUNTIME = VERSION_CHECK + """const fs=require('node:fs'),p=require('node:path');let data=process.env.RELAY_DATA_FILE||null;
if(data){let probe=p.resolve(data),tail=[];while(!fs.existsSync(probe)){tail.unshift(p.basename(probe));const parent=p.dirname(probe);if(parent===probe)break;probe=parent;}data=p.join(fs.realpathSync(probe),...tail);}
process.stdout.write(JSON.stringify({dataFile:data}));"""
HEALTH = """const h=process.env.RELAY_HOST||'127.0.0.1';const host=['0.0.0.0','::'].includes(h)?'127.0.0.1':h;
fetch('http://'+(host.includes(':')?'['+host+']':host)+':'+(process.env.RELAY_PORT||8790)+'/healthz',{signal:AbortSignal.timeout(2000)})
.then(async r=>{if(!r.ok||(await r.json()).ok!==true)process.exit(1)}).catch(()=>process.exit(1));"""


class Refused(Exception):
    pass


SIGNALS = (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)
INTERRUPTED = None


def check_interrupted():
    if INTERRUPTED:
        raise Refused(f"Update interrupted by {INTERRUPTED}")


@contextlib.contextmanager
def rollback_signals_ignored():
    # Once recovery starts, another terminal signal must not interrupt it halfway.
    global INTERRUPTED
    INTERRUPTED = None
    previous = {sig: signal.signal(sig, signal.SIG_IGN) for sig in SIGNALS}
    try:
        yield
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def run(args, *, cwd=None, label="command", timeout=180):
    # Raw Compose, process environments, service logs and npm output are never printed.
    check_interrupted()
    try:
        result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=True,
                                timeout=timeout, umask=0o022, start_new_session=True)
    except (subprocess.SubprocessError, OSError) as error:
        raise Refused(f"{label} failed") from error
    check_interrupted()
    return result.stdout.strip()


def plain_file(path):
    return path.is_file() and not path.is_symlink()


def copy_file(source, target, metadata=None):
    shutil.copy2(source, target)
    info = metadata or source.stat()
    os.chmod(target, stat.S_IMODE(info.st_mode))
    os.chown(target, info.st_uid, info.st_gid)


def atomic_bytes(path, data, metadata):
    temporary = path.with_name(f".{path.name}.update-{uuid.uuid4().hex}")
    try:
        with temporary.open("xb") as handle:
            os.fchmod(handle.fileno(), stat.S_IMODE(metadata.st_mode))
            os.fchown(handle.fileno(), metadata.st_uid, metadata.st_gid)
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


@contextlib.contextmanager
def update_lock(directory):
    fd = os.open(directory / ".relay-update.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise Refused("Another Relay update holds the lock; nothing was changed") from error
        yield
    finally:
        os.close(fd)


def wait_health(check, attempts):
    for attempt in range(attempts):
        check_interrupted()
        try:
            healthy = check()
            check_interrupted()
            if healthy:
                return True
        except (Refused, OSError, ValueError):
            pass
        if attempt + 1 < attempts:
            time.sleep(1)
    return False


def prepare(directory, install):
    build = directory / "build"
    build.mkdir()
    for name in FILES:
        copy_file(SOURCE / name, build / name)
    install(build)
    return build


def app_mount(service):
    found = []
    for index, value in enumerate(service.get("volumes", [])):
        if isinstance(value, str):
            parts = value.split(":")
            if len(parts) in (2, 3) and parts[1] == "/app":
                found.append((index, Path(parts[0]), parts))
        elif isinstance(value, dict) and value.get("target") == "/app":
            if value.get("type") != "bind" or not isinstance(value.get("source"), str):
                raise Refused("The /app mount must be a bind mount")
            found.append((index, Path(value["source"]), None))
    if len(found) != 1:
        raise Refused("Expected exactly one /app bind mount")
    return found[0]


def reject_code_overlays(service=None, mounts=()):
    """A child mount can hide candidate code even when the /app mount is correct."""
    targets = [item.get("Destination") for item in mounts]
    if service:
        if service.get("volumes_from"):
            raise Refused("volumes_from is unsupported; Relay code mounts must be explicit")
        for value in service.get("volumes", []):
            if isinstance(value, dict):
                targets.append(value.get("target"))
            elif isinstance(value, str):
                parts = value.split(":")
                targets.append(parts[1] if len(parts) > 1 and parts[1].startswith("/") else parts[0])
        tmpfs = service.get("tmpfs", [])
        for value in [tmpfs] if isinstance(tmpfs, str) else tmpfs:
            if isinstance(value, str):
                targets.append(value.split(":")[0])
        for key in ("configs", "secrets"):
            targets.extend(value.get("target") for value in service.get(key, []) if isinstance(value, dict))
    if any(isinstance(target, str) and (posixpath.normpath(target) == "/app/relay"
           or posixpath.normpath(target).startswith("/app/relay/")) for target in targets):
        raise Refused("A nested mount hides Relay code or dependencies; review this layout before updating")


class Compose:
    def __init__(self, args):
        self.args = args
        self.file = Path(args.compose).absolute()
        if not plain_file(self.file):
            raise Refused("Compose must be an existing regular JSON file")
        self.base = self.file.parent
        self.original = self.file.read_bytes()
        self.metadata = self.file.stat()
        try:
            self.config = json.loads(self.original)
            services = self.config["services"]
            matches = [name for name, service in services.items() if service.get("working_dir") == "/app/relay"]
            self.service = args.service or (matches[0] if len(matches) == 1 else None)
            self.definition = services[self.service]
            self.index, self.previous, self.parts = app_mount(self.definition)
        except (ValueError, TypeError, KeyError, AttributeError) as error:
            raise Refused("Unknown Compose layout; specify one Relay service with working_dir /app/relay") from error
        releases = self.base / "releases"
        if (self.definition.get("working_dir") != "/app/relay" or not self.previous.is_absolute()
                or self.previous.parent != releases or self.previous.is_symlink() or not self.previous.is_dir()
                or (self.previous / "relay").is_symlink() or not (self.previous / "relay").is_dir()
                or not plain_file(self.previous / "relay/server.mjs")):
            raise Refused("Expected an existing releases/<version> bind at /app and a regular relay directory")
        if not isinstance(self.definition.get("image"), str) or self.definition.get("build"):
            raise Refused("Relay must use an existing image, without a build directive")
        reject_code_overlays(service=self.definition)
        if self.service.startswith("-") or not self.service.replace("-", "").replace("_", "").isalnum():
            raise Refused("Invalid Compose service name")
        for name in FILES:
            old = self.previous / "relay" / name
            if (old.exists() or old.is_symlink()) and not plain_file(old):
                raise Refused("Existing Relay code entries must be regular files")
        run(self.command("config", "--quiet"), label="Compose preflight")
        self.image = run(["docker", "inspect", "--format", "{{.Image}}", self.container()], label="Relay image lookup")
        if not self.image.startswith("sha256:"):
            raise Refused("Cannot identify the installed Relay image")
        configured_image = run(["docker", "image", "inspect", "--format", "{{.Id}}", self.definition["image"]], label="Configured Relay image lookup")
        if configured_image != self.image:
            raise Refused("Configured Relay image no longer matches the running image; review that change separately")
        volumes = json.loads(run(["docker", "image", "inspect", "--format", "{{json .Config.Volumes}}", self.image], label="Relay image volume check")) or {}
        reject_code_overlays(mounts=[{"Destination": target} for target in volumes])
        runtime = json.loads(run(self.command("exec", "-T", self.service, "node", "-e", RUNTIME), label="Relay runtime check"))
        data = runtime.get("dataFile")
        if data and (data == "/app" or data.startswith("/app/")):
            raise Refused("Mutable Relay data is inside the code release; use a separate persistent mount before updating")
        if data:
            mounts = json.loads(run(["docker", "inspect", "--format", "{{json .Mounts}}", self.container()], label="Relay data mount check"))
            persistent = [Path(item["Destination"]) for item in mounts
                          if item.get("Type") in ("bind", "volume") and item.get("Destination") not in (None, "/", "/app")]
            if not any(Path(data) == target or target in Path(data).parents for target in persistent):
                raise Refused("Mutable Relay data needs a separate persistent mount before container recreation")
        self.verify(self.previous)
        self.changed = False

    def command(self, *args):
        return ["docker", "compose", "-f", str(self.file), *args]

    def container(self):
        ids = run(self.command("ps", "--all", "-q", self.service), label="Relay container lookup").splitlines()
        if len(ids) != 1 or not ids[0]:
            raise Refused("Expected one installed Relay container")
        return ids[0]

    def verify(self, release):
        container = self.container()
        state = json.loads(run(["docker", "inspect", "--format", "{{json .State}}", container], label="Relay state check"))
        mounts = json.loads(run(["docker", "inspect", "--format", "{{json .Mounts}}", container], label="Relay mount check"))
        reject_code_overlays(mounts=mounts)
        workdir = run(["docker", "inspect", "--format", "{{.Config.WorkingDir}}", container], label="Relay working directory check")
        image = run(["docker", "inspect", "--format", "{{.Image}}", container], label="Relay image verification")
        actual = [item for item in mounts if item.get("Destination") == "/app"]
        if (state.get("Running") is not True or state.get("Paused") is True or workdir != "/app/relay" or image != self.image
                or len(actual) != 1 or actual[0].get("Type") != "bind" or Path(actual[0].get("Source", "")) != release):
            raise Refused("Relay is not running from the expected code release")

    def healthy(self, release):
        self.verify(release)
        run(self.command("exec", "-T", self.service, "node", "-e", HEALTH), label="Relay health check", timeout=10)
        return True

    def restart(self):
        # Let the daemon operation finish before recovering; killing its CLI does not cancel it.
        run(self.command("up", "-d", "--no-deps", "--force-recreate", "--no-build", "--pull", "never", self.service), label="Relay service restart", timeout=None)

    def update(self):
        directory = Path(tempfile.mkdtemp(prefix=".relay-update-", dir=self.base))
        backup = directory / "compose.original.json"
        copy_file(self.file, backup)
        release = None
        try:
            def install(build):
                if "," in str(build):
                    raise Refused("A build path containing commas is unsupported")
                run(["docker", "run", "--rm", "--pull=never", "--user", "0:0", "--entrypoint", "node",
                     "--mount", f"type=bind,src={build},dst=/work", "--workdir", "/work", self.image, "-e", BUILD], label="Candidate dependency and import validation", timeout=600)
            build = prepare(directory, install)
            digest = hashlib.sha256(b"".join((build / name).read_bytes() for name in FILES)).hexdigest()[:12]
            release = self.base / "releases" / f"relay-{digest}-{uuid.uuid4().hex[:8]}"
            # Preserve other files the current entrypoint might require. The old release is untouched.
            run(["cp", "-a", "--", str(self.previous), str(release)], label="Release staging")
            relay = release / "relay"
            for name in FILES:
                old = relay / name
                metadata = old.stat() if plain_file(old) else None
                if old.is_symlink():
                    old.unlink()
                copy_file(build / name, old, metadata)
                if metadata is None:
                    os.chmod(old, 0o644)
                    info = relay.stat()
                    os.chown(old, info.st_uid, info.st_gid)
            dependencies = relay / "node_modules"
            if dependencies.is_symlink():
                dependencies.unlink()
            elif dependencies.exists():
                shutil.rmtree(dependencies)
            shutil.copytree(build / "node_modules", dependencies, symlinks=True)
            mount = self.definition["volumes"][self.index]
            if self.parts:
                self.parts[0] = str(release)
                self.definition["volumes"][self.index] = ":".join(self.parts)
            else:
                mount["source"] = str(release)
            candidate = directory / "compose.candidate.json"
            candidate.write_text(json.dumps(self.config, indent=2) + "\n")
            # Keep relative mounts/env_file paths based at the real Compose directory.
            check = self.file.with_name(f".compose-check-{uuid.uuid4().hex}.json")
            try:
                copy_file(candidate, check, self.metadata)
                run(["docker", "compose", "-f", str(check), "config", "--quiet"], label="Candidate Compose validation")
            finally:
                check.unlink(missing_ok=True)
            self.changed = True
            atomic_bytes(self.file, candidate.read_bytes(), self.metadata)
            self.restart()
            if not wait_health(lambda: self.healthy(release), self.args.health_attempts):
                raise Refused("Candidate Relay health or release verification failed")
            print(f"Relay updated; previous release retained at {self.previous}; rollback config: {backup}")
        except BaseException as error:
            if self.changed:
                try:
                    with rollback_signals_ignored():
                        atomic_bytes(self.file, self.original, self.metadata)
                        self.restart()
                        if not wait_health(lambda: self.healthy(self.previous), self.args.health_attempts):
                            raise Refused("Previous Relay health could not be confirmed")
                except BaseException as rollback_error:
                    raise Refused(f"Update failed; original Compose restore/restart could not be confirmed. Backup: {backup}") from rollback_error
                raise Refused(f"Update failed; original Compose and Relay release restored. Backup: {backup}") from error
            if release and release.exists():
                shutil.rmtree(release)
            raise


class Systemd:
    def __init__(self, args):
        self.args = args
        self.service = args.service or os.environ.get("RELAY_SERVICE") or "ds-bot-relay"
        if self.service.startswith("-") or not self.service.replace("-", "").replace("_", "").isalnum():
            raise Refused("Invalid systemd service name")
        run(["systemctl", "cat", f"{self.service}.service"], label="Systemd service lookup")
        self.base = Path(run(["systemctl", "show", "-p", "WorkingDirectory", "--value", self.service], label="Service directory lookup"))
        if not self.base.is_absolute() or self.base.is_symlink() or not plain_file(self.base / "server.mjs"):
            raise Refused("Systemd WorkingDirectory must contain regular Relay source files")
        self.node = shutil.which("node")
        if not self.node:
            raise Refused("Node.js is required for the systemd update")
        run([self.node, "-e", VERSION_CHECK], label="Node version check")
        parsed = urlsplit(args.health_url)
        try:
            local = ipaddress.ip_address(parsed.hostname).is_loopback
        except ValueError:
            local = False
        if not local or parsed.scheme != "http" or parsed.username or parsed.password or parsed.path != "/healthz" or parsed.query or parsed.fragment:
            raise Refused("Use an explicit loopback HTTP /healthz URL for systemd")
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def healthy(self):
        run(["systemctl", "is-active", "--quiet", self.service], label="Service state check")
        with self.opener.open(self.args.health_url, timeout=2) as response:
            return response.status == 200 and json.load(response).get("ok") is True

    def restart(self):
        run(["systemctl", "restart", self.service], label="Relay service restart", timeout=None)

    def update(self):
        directory = Path(tempfile.mkdtemp(prefix=".relay-update-", dir=self.base.parent))
        backup = directory / "previous"
        backup.mkdir()
        changed = False
        had = set()
        had_dependencies = (self.base / "node_modules").exists()
        try:
            def install(build):
                run([self.node, "-e", BUILD], cwd=build, label="Candidate dependency and import validation", timeout=600)
            build = prepare(directory, install)
            for name in FILES:
                path = self.base / name
                if path.exists() or path.is_symlink():
                    if not plain_file(path):
                        raise Refused("Existing Relay code entries must be regular files")
                    copy_file(path, backup / name)
                    had.add(name)
            dependencies = self.base / "node_modules"
            if dependencies.is_symlink() or (dependencies.exists() and not dependencies.is_dir()):
                raise Refused("Existing node_modules must be a regular directory")
            changed = True
            for name in FILES:
                current = self.base / name
                metadata = current.stat() if name in had else self.base.stat()
                temporary = self.base / f".{name}.update-{uuid.uuid4().hex}"
                try:
                    copy_file(build / name, temporary, metadata)
                    os.chmod(temporary, stat.S_IMODE(metadata.st_mode) if name in had else 0o644)
                    os.replace(temporary, current)
                finally:
                    temporary.unlink(missing_ok=True)
            if dependencies.exists():
                os.replace(dependencies, backup / "node_modules")
            os.replace(build / "node_modules", dependencies)
            self.restart()
            if not wait_health(self.healthy, self.args.health_attempts):
                raise Refused("Candidate Relay health verification failed")
            print(f"Relay updated; previous code retained at {backup}. Configuration and data were not replaced.")
        except BaseException as error:
            if changed:
                try:
                    with rollback_signals_ignored():
                        for name in FILES:
                            current = self.base / name
                            if name in had:
                                atomic_bytes(current, (backup / name).read_bytes(), (backup / name).stat())
                            else:
                                current.unlink(missing_ok=True)
                        dependencies = self.base / "node_modules"
                        if (backup / "node_modules").exists():
                            if dependencies.exists():
                                shutil.rmtree(dependencies)
                            os.replace(backup / "node_modules", self.base / "node_modules")
                        elif not had_dependencies and dependencies.exists():
                            shutil.rmtree(dependencies)
                        self.restart()
                        if not wait_health(self.healthy, self.args.health_attempts):
                            raise Refused("Previous Relay health could not be confirmed")
                except BaseException as rollback_error:
                    raise Refused(f"Update failed; previous code restore/restart could not be confirmed. Backup: {backup}") from rollback_error
                raise Refused(f"Update failed; previous code and Relay service restored. Backup: {backup}") from error
            raise


def main(argv=None):
    global INTERRUPTED
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("auto", "compose", "systemd"), default="auto")
    parser.add_argument("--compose", default="/opt/ds-bot-relay/compose.json")
    parser.add_argument("--service", help="Relay Compose service or systemd unit name; never a container name")
    parser.add_argument("--health-url", default="http://127.0.0.1:8790/healthz")
    parser.add_argument("--health-attempts", type=int, choices=range(1, 61), default=20)
    parser.add_argument("--check", action="store_true", help="Read-only preflight; actual update validates again under its lock")
    args = parser.parse_args(argv)
    previous_signals = {}
    try:
        if not args.check and os.geteuid() != 0:
            raise Refused("Run the update as root; --check is read-only")
        if args.service and (not args.service.replace("-", "").replace("_", "").isalnum() or args.service.startswith("-")):
            raise Refused("Invalid service name")
        for name in FILES:
            if not plain_file(SOURCE / name):
                raise Refused(f"Upload the complete Relay directory; missing {name}")
        compose = args.mode == "compose" or (args.mode == "auto" and Path(args.compose).exists())
        if compose and os.environ.get("RELAY_SERVICE") and not args.service:
            raise Refused("RELAY_SERVICE names a systemd unit; use --service explicitly for Compose")
        installation = Compose(args) if compose else Systemd(args)
        if args.check:
            print(f"Preflight passed for {'Compose' if compose else 'systemd'} Relay service {installation.service}. No files or services changed; revalidated when applying.")
            return 0
        def interrupted(signum, _frame):
            global INTERRUPTED
            INTERRUPTED = INTERRUPTED or signal.Signals(signum).name
        previous_signals = {sig: signal.signal(sig, interrupted) for sig in SIGNALS}
        with update_lock(installation.base):
            installation = Compose(args) if compose else Systemd(args)
            installation.update()
        return 0
    except (Refused, OSError, ValueError) as error:
        print(f"Relay update refused: {error}", file=sys.stderr)
        return 1
    finally:
        for sig, handler in previous_signals.items():
            signal.signal(sig, handler)


if __name__ == "__main__":
    sys.exit(main())
