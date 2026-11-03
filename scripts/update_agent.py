#!/usr/bin/env python3
"""Unprivileged macOS host bridge. Never runs a browser-supplied command.

See docs/UPDATES.md for IPC and the existing host updater's protocol contract.
Only the explicit POST /v1/start endpoint can create an operation.
"""
from contextlib import closing
import argparse
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen

REPO = 'perevozchiko/capital-tracker'
API = f'https://api.github.com/repos/{REPO}/releases/latest'
STAGES = ['build', 'test', 'backup', 'sqlite_check', 'switch', 'health_check']
VERSION = r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)'


def version(value, stable=False):
    pattern = VERSION + ('' if stable else r'(?:-(?:alpha|beta|rc)\.[1-9][0-9]*)?')
    match = re.fullmatch(pattern, value)
    if not match:
        raise ValueError('invalid_version')
    return tuple(int(n) for n in match.groups()[:3])


def newer(target, current):
    return version(target, True) > version(current) or (
        version(target, True) == version(current) and '-' in current)


def atomic_json(path, value):
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temp.open('x') as stream:
            os.chmod(temp, 0o600)
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
        fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        temp.unlink(missing_ok=True)


def read_json(path, fallback=None):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return fallback


def lock_file(path):
    stream = path.open('a+')
    try:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return stream
    except BlockingIOError:
        stream.close()
        return None


def latest_release():
    request = Request(API, headers={'Accept': 'application/vnd.github+json',
                                   'User-Agent': 'capital-tracker-host-agent/1'})
    with urlopen(request, timeout=10) as response:
        raw = response.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError('invalid_release')
    release = json.loads(raw)
    tag = release['tag_name']
    if release.get('draft') is not False or release.get('prerelease') is not False:
        raise ValueError('invalid_release')
    if not isinstance(tag, str) or not tag.startswith('v'):
        raise ValueError('invalid_release')
    version(tag[1:], True)
    if type(release['id']) is not int or release['id'] <= 0:
        raise ValueError('invalid_release')
    return {'version': tag[1:], 'tag': tag, 'release_id': release['id'],
            'url': f'https://github.com/{REPO}/releases/tag/{tag}'}


class Agent:
    def __init__(self, config_path):
        self.config_path = str(Path(config_path).resolve())
        self.config = read_json(Path(self.config_path))
        self.root = Path(self.config['state_dir'])
        if not self.root.is_absolute():
            raise ValueError('state_dir must be absolute')
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.root, 0o700)
        key_path = Path(self.config['key_file'])
        if key_path.stat().st_mode & 0o077:
            raise ValueError('key_file must have owner-only permissions')
        self.key = key_path.read_text().strip().encode()
        if not re.fullmatch(rb'[0-9a-f]{64}', self.key):
            raise ValueError('key_file must contain 64 lowercase hex characters')
        self.argv = self.config.get('updater_argv', [])
        self.enabled = (self.config.get('updater_protocol') == 1 and
                        isinstance(self.argv, list) and bool(self.argv) and
                        all(isinstance(s, str) for s in self.argv) and
                        Path(self.argv[0]).is_absolute() and
                        os.access(self.argv[0], os.X_OK))
        self.mutex = threading.Lock()
        self.recover()

    def recover(self):
        # A detached worker retains this lock across agent/app restarts. If it
        # disappeared, never rerun a possibly half-completed deployment.
        lock = lock_file(self.root / 'operation.lock')
        if lock is not None:
            with lock:
                op = self.operation()
                if op and op['status'] == 'running':
                    op.update(status='recovery_required', result='worker_interrupted')
                    self.save(op)

    def operation(self):
        return read_json(self.root / 'operation.json')

    def save(self, op):
        op['updated_at'] = int(time.time())
        atomic_json(self.root / 'operation.json', op)

    def status(self):
        self.recover()
        op = self.operation()
        return {'enabled': bool(self.enabled), 'release': read_json(self.root / 'release.json'),
                'operation': op}

    def authenticate(self, method, path, headers, body):
        stamp = headers.get('X-Update-Time', '')
        nonce = headers.get('X-Update-Nonce', '')
        if not re.fullmatch(r'[0-9]{10}', stamp) or abs(time.time() - int(stamp)) > 30:
            return False
        if not re.fullmatch(r'[0-9a-f]{48}', nonce):
            return False
        message = f'{method}\n{path}\n{stamp}\n{nonce}\n'.encode() + body
        digest = hmac.new(self.key, message, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(digest, headers.get('X-Update-Signature', '')):
            return False
        # Persist nonces so restarting the agent does not permit replay.
        with closing(sqlite3.connect(self.root / 'ipc.sqlite', timeout=5)) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, stamp INTEGER)')
            db.execute('DELETE FROM nonces WHERE stamp < ?', (int(time.time()) - 60,))
            try:
                db.execute('INSERT INTO nonces VALUES (?, ?)', (nonce, int(stamp)))
            except sqlite3.IntegrityError:
                return False
        return True

    def action(self, action, payload):
        if action == 'status':
            return 200, self.status()
        if not self.enabled:
            return 503, {'error': {'code': 'update_unavailable'}}
        expected = {'current_version'} if action == 'check' else {
            'current_version', 'target_version', 'request_id'}
        if not isinstance(payload, dict) or set(payload) != expected:
            return 400, {'error': {'code': 'invalid_json'}}
        try:
            version(payload['current_version'])
            if action == 'start':
                version(payload['target_version'], True)
                if not re.fullmatch(r'[0-9a-f-]{36}', payload['request_id']):
                    raise ValueError('invalid_request_id')
        except (ValueError, TypeError):
            return 400, {'error': {'code': 'invalid_json'}}
        with self.mutex:
            lock = lock_file(self.root / 'operation.lock')
            if lock is None:
                return 200, self.status()  # All concurrent clicks join this operation.
            with lock:
                op = self.operation()
                if op and (op['status'] in ('running', 'recovery_required') or
                           (action == 'start' and (op['request_id'] == payload['request_id'] or
                            (op['status'] == 'succeeded' and op['target_version'] == payload['target_version']
                             and op['current_version'] == payload['current_version'])))):
                    return 200, self.status()
                try:
                    release = latest_release()  # Always re-resolve on explicit start.
                except Exception:
                    return 502, {'error': {'code': 'update_check_failed'}}
                atomic_json(self.root / 'release.json', release)
                if action == 'check':
                    return 200, self.status()
                if (payload['target_version'] != release['version'] or
                        not newer(release['version'], payload['current_version'])):
                    return 409, {'error': {'code': 'update_release_changed'}}
                op = {'id': str(uuid.uuid4()), 'request_id': payload['request_id'],
                      'status': 'running', 'stage': 'queued', 'stages': [],
                      'current_version': payload['current_version'], 'target_version': release['version'],
                      'release': release, 'started_at': int(time.time())}
                self.save(op)
                try:
                    # Pass the *already acquired* lock: no gap before the worker.
                    worker = subprocess.Popen([sys.executable, str(Path(__file__).resolve()),
                                      '--config', self.config_path, '--worker-fd', str(lock.fileno())],
                                     pass_fds=(lock.fileno(),), start_new_session=True,
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL)
                    threading.Thread(target=worker.wait, daemon=True).start()
                except Exception:
                    op.update(status='failed', result='worker_start_failed')
                    self.save(op)
                return 202, self.status()


def run_worker(agent, fd):
    # The descriptor is intentionally held until the updater has finished.
    with os.fdopen(fd, 'a+'):
        op = agent.operation()
        request = {'protocol': 1, 'repository': REPO, 'operation_id': op['id'],
                   'current_version': op['current_version'], 'release': op['release']}
        bad_protocol, result = False, None
        try:
            with (agent.root / f"{op['id']}.log").open('ab', buffering=0) as log:
                process = subprocess.Popen(agent.argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                           stderr=log, text=True)
                process.stdin.write(json.dumps(request) + '\n')
                process.stdin.close()
                while True:
                    line = process.stdout.readline(65537)
                    if not line:
                        break
                    try:
                        if len(line) > 65536 or not line.endswith('\n'):
                            raise ValueError('oversized_event')
                        event = json.loads(line)
                        if result is not None:
                            raise ValueError('event_after_result')
                        if event.get('event') == 'stage' and event.get('stage') in STAGES + ['rollback']:
                            stage = event['stage']
                            if stage != 'rollback' and op['stages'] != STAGES[:STAGES.index(stage)]:
                                raise ValueError('out_of_order_stage')
                            if 'rollback' in op['stages']:
                                raise ValueError('event_after_rollback')
                            op['stage'] = stage
                            op['stages'].append(stage)
                            agent.save(op)
                        elif event.get('event') == 'result' and event.get('outcome') in (
                                'succeeded', 'failed', 'rolled_back', 'recovery_required'):
                            result = event
                        else:
                            raise ValueError('invalid_event')
                    except (ValueError, TypeError, AttributeError):
                        bad_protocol = True
                process.stdout.close()
                code = process.wait()
            if bad_protocol or result is None:
                raise ValueError('updater_protocol_error')
            outcome = result['outcome']
            if outcome != 'succeeded' and code == 0:
                raise ValueError('invalid_exit_status')
            if outcome == 'succeeded' and (code != 0 or op['stages'] != STAGES or
                    result.get('verified_version') != op['target_version']):
                raise ValueError('unverified_update')
            if outcome == 'rolled_back' and ('rollback' not in op['stages'] or
                    result.get('verified_version') != op['current_version']):
                raise ValueError('unverified_rollback')
            if outcome == 'failed' and 'switch' in op['stages']:
                raise ValueError('rollback_not_verified')
            op.update(status=outcome, result=outcome)
        except Exception:
            # Never call a deployment successful or safe to retry without proof.
            op.update(status='recovery_required', result='updater_failed')
        agent.save(op)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'

    def log_message(self, *_):
        pass  # Never log signatures, headers or financial data.

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def do_GET(self):
        self.handle_api()

    def do_POST(self):
        self.handle_api()

    def handle_api(self):
        agent = self.server.agent
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length < 0 or length > 4096 or self.headers.get('Transfer-Encoding'):
                self.send_error(400)
                return
            body = self.rfile.read(length)
            if len(body) != length or not agent.authenticate(self.command, self.path, self.headers, body):
                self.send_error(403)
                return
            action = {('GET', '/v1/status'): 'status', ('POST', '/v1/check'): 'check',
                      ('POST', '/v1/start'): 'start'}.get((self.command, self.path))
            if not action:
                code, data = 404, {'error': {'code': 'not_found'}}
            elif action == 'status' and body:
                code, data = 400, {'error': {'code': 'invalid_json'}}
            else:
                try:
                    payload = json.loads(body) if body else {}
                except ValueError:
                    payload = None
                code, data = agent.action(action, payload)
        except Exception:
            code, data = 500, {'error': {'code': 'update_unavailable'}}
        raw = json.dumps(data, separators=(',', ':')).encode()
        nonce = self.headers.get('X-Update-Nonce', '')
        signed = f'{nonce}\n{code}\n'.encode() + raw
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Update-Signature', hmac.new(agent.key, signed, hashlib.sha256).hexdigest())
        self.end_headers()
        self.wfile.write(raw)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--worker-fd', type=int)
    args = parser.parse_args()
    agent = Agent(args.config)
    if args.worker_fd is not None:
        run_worker(agent, args.worker_fd)
        return
    daemon_lock = lock_file(agent.root / 'agent.lock')
    if daemon_lock is None:
        raise SystemExit('agent already running')
    with daemon_lock:
        server = ThreadingHTTPServer((agent.config.get('listen_host', '127.0.0.1'),
                                      agent.config.get('listen_port', 18765)), Handler)
        server.daemon_threads = True
        server.agent = agent
        server.serve_forever()


if __name__ == '__main__':
    main()
