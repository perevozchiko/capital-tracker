"""Host protocol/SQLite lifecycle tests. Everything lives in TemporaryDirectory."""
from contextlib import closing
import concurrent.futures
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid

if os.name != 'posix':
    raise unittest.SkipTest('The macOS host update agent requires Unix flock')

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('update_agent', ROOT / 'scripts/update_agent.py')
agent = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(agent)
FETCH_LATEST = agent.latest_release
RELEASE = {'version': '0.4.0', 'tag': 'v0.4.0', 'release_id': 123,
           'url': 'https://github.com/perevozchiko/capital-tracker/releases/tag/v0.4.0'}

# This fixed local updater exercises the contract using a real SQLite backup and
# deployment marker. It intentionally has no Docker or production configuration.
UPDATER = r'''
from contextlib import closing
import json, pathlib, sqlite3, sys, time
root = pathlib.Path(__file__).parent
request = json.loads(sys.stdin.readline())
assert request['protocol'] == 1 and request['repository'] == 'perevozchiko/capital-tracker'
mode = (root / 'mode').read_text()
with (root / 'calls').open('a') as f: f.write(request['operation_id'] + '\n')
def emit(**kw): print(json.dumps(kw), flush=True)
def stage(s): emit(event='stage', stage=s)
for s in ['build', 'test', 'backup', 'sqlite_check', 'switch', 'health_check']:
    stage(s)
    if s == 'build':
        while (root / 'hold').exists(): time.sleep(.02)
        if mode == 'build_error':
            emit(event='result', outcome='failed'); sys.exit(1)
    if s == 'backup':
        (root / 'backup.db').unlink(missing_ok=True)
        with closing(sqlite3.connect(root / 'capital.db')) as source, source:
            with closing(sqlite3.connect(root / 'backup.db')) as dest, dest: source.backup(dest)
    if s == 'sqlite_check':
        if mode == 'sqlite_error':
            (root / 'backup.db').write_bytes(b'corrupted backup')
            try:
                with closing(sqlite3.connect(root / 'backup.db')) as db:
                    db.execute('pragma integrity_check').fetchone()
            except sqlite3.DatabaseError:
                emit(event='result', outcome='failed'); sys.exit(1)
            raise AssertionError('accepted corrupt backup')
        with closing(sqlite3.connect(root / 'backup.db')) as db, db:
            assert db.execute('pragma integrity_check').fetchone()[0] == 'ok'
    if s == 'switch':
        (root / 'installed').write_text(request['release']['version'])
        with closing(sqlite3.connect(root / 'capital.db')) as db, db: db.execute("update balances set amount=999")
    if s == 'health_check' and mode in ('health_error', 'rollback_error'):
        stage('rollback')
        if mode == 'rollback_error':
            emit(event='result', outcome='recovery_required'); sys.exit(1)
        with closing(sqlite3.connect(root / 'backup.db')) as backup, backup:
            with closing(sqlite3.connect(root / 'capital.db')) as db, db: backup.backup(db)
        (root / 'installed').write_text(request['current_version'])
        with closing(sqlite3.connect(root / 'capital.db')) as db, db:
            assert db.execute('pragma integrity_check').fetchone()[0] == 'ok'
        emit(event='result', outcome='rolled_back', verified_version=request['current_version'])
        sys.exit(1)
if mode == 'false_success':
    emit(event='result', outcome='succeeded', verified_version='9.9.9')
elif mode == 'malformed':
    print('not JSON', flush=True)
else:
    emit(event='result', outcome='succeeded', verified_version=request['release']['version'])
'''


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='capital-update-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.key = 'a' * 64
        (self.root / 'key').write_text(self.key)
        (self.root / 'key').chmod(0o600)
        (self.root / 'updater.py').write_text(UPDATER)
        (self.root / 'mode').write_text('success')
        (self.root / 'installed').write_text('0.3.2')
        with closing(sqlite3.connect(self.root / 'capital.db')) as db, db:
            db.execute('pragma journal_mode=wal')
            db.execute('create table balances (amount integer)')
            db.execute('insert into balances values (12345)')
        self.config = self.root / 'config.json'
        self.config.write_text(json.dumps({'state_dir': str(self.root / 'state'),
            'key_file': str(self.root / 'key'), 'updater_protocol': 1,
            'updater_argv': [sys.executable, str(self.root / 'updater.py')]}))
        self.a = agent.Agent(self.config)
        self.mock = patch.object(agent, 'latest_release', return_value=RELEASE.copy())
        self.latest = self.mock.start()
        self.addCleanup(self.mock.stop)

    def start(self, **kwargs):
        return self.a.action('start', {'current_version': '0.3.2',
            'target_version': '0.4.0', 'request_id': str(uuid.uuid4()), **kwargs})

    def wait(self, status=None):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            op = self.a.operation()
            if op and op['status'] != 'running':
                if status: self.assertEqual(op['status'], status, op)
                # Wait for the worker's final lock release as well.
                lock = agent.lock_file(self.a.root / 'operation.lock')
                if lock:
                    lock.close()
                    return op
            time.sleep(.02)
        self.fail('worker did not finish')

    def amount(self):
        with closing(sqlite3.connect(self.root / 'capital.db')) as db, db:
            self.assertEqual(db.execute('pragma integrity_check').fetchone(), ('ok',))
            return db.execute('select amount from balances').fetchone()[0]

    def test_check_and_restart_never_update(self):
        self.assertIsNone(self.a.operation())
        code, value = self.a.action('check', {'current_version': '0.3.2'})
        self.assertEqual(code, 200)
        self.assertEqual(value['release']['version'], '0.4.0')
        self.assertIsNone(agent.Agent(self.config).operation())
        self.assertFalse((self.root / 'calls').exists())
        self.assertEqual(self.amount(), 12345)

    def test_success_persistent_idempotency_and_newer_version(self):
        code, response = self.start()
        self.assertEqual(code, 202)
        operation = self.wait('succeeded')
        self.assertEqual(self.amount(), 999)
        self.assertEqual((self.root / 'installed').read_text(), '0.4.0')
        self.assertEqual(operation['stages'], agent.STAGES)
        self.a = agent.Agent(self.config)
        self.assertEqual(self.a.status()['operation']['id'], operation['id'])
        self.start(request_id=operation['request_id'])
        self.start()  # Stale app cannot reapply successful target with a new UUID.
        self.assertEqual(len((self.root / 'calls').read_text().splitlines()), 1)
        self.assertEqual(self.start(current_version='0.4.0')[0], 409)
        self.assertEqual(self.start(current_version='0.5.0')[0], 409)

    def test_double_click_workers_join_and_survive_agent_restart(self):
        (self.root / 'hold').touch()
        self.start()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            values = list(pool.map(lambda _: self.start(), range(12)))
        ids = {value['operation']['id'] for _, value in values}
        self.assertEqual(len(ids), 1)
        self.a = agent.Agent(self.config)
        self.assertEqual(self.a.operation()['status'], 'running')
        (self.root / 'hold').unlink()
        self.wait('succeeded')
        self.assertEqual(len((self.root / 'calls').read_text().splitlines()), 1)

    def test_errors_rollback_and_explicit_retry(self):
        for mode, outcome, amount in [('build_error', 'failed', 12345),
                                      ('sqlite_error', 'failed', 12345),
                                      ('health_error', 'rolled_back', 12345),
                                      ('success', 'succeeded', 999)]:
            (self.root / 'mode').write_text(mode)
            self.assertEqual(self.start()[0], 202)
            op = self.wait(outcome)
            self.assertEqual(self.amount(), amount)
            if mode == 'health_error':
                self.assertIn('rollback', op['stages'])
                self.assertEqual((self.root / 'installed').read_text(), '0.3.2')

    def test_unverified_results_and_failed_rollback_block_retries(self):
        for mode in ('false_success', 'malformed', 'rollback_error'):
            with self.subTest(mode=mode):
                (self.root / 'mode').write_text(mode)
                self.start()
                self.wait('recovery_required')
                count = len((self.root / 'calls').read_text().splitlines())
                self.start()
                self.assertEqual(len((self.root / 'calls').read_text().splitlines()), count)
                # Test-only manual recovery reset, after the lock is released.
                (self.a.root / 'operation.json').unlink()

    def test_interrupted_operation_requires_manual_recovery(self):
        self.a.save({'status': 'running', 'id': 'interrupted', 'request_id': str(uuid.uuid4())})
        self.assertEqual(self.a.status()['operation']['status'], 'recovery_required')
        restarted = agent.Agent(self.config)
        self.assertEqual(restarted.operation()['status'], 'recovery_required')
        self.start()
        self.assertFalse((self.root / 'calls').exists())

    def test_github_errors_changed_release_and_untrusted_payload(self):
        self.latest.side_effect = OSError('offline')
        self.assertEqual(self.start()[0], 502)
        self.assertIsNone(self.a.operation())
        self.latest.side_effect = None
        self.assertEqual(self.start(target_version='0.3.9')[0], 409)
        self.assertEqual(self.start(target_version='0.4.0-rc.1')[0], 400)
        self.assertEqual(self.start(command='rm -rf /')[0], 400)
        self.assertEqual(self.start(current_version='$(whoami)')[0], 400)
        self.assertFalse((self.root / 'calls').exists())

    def test_no_updater_is_disabled(self):
        config = json.loads(self.config.read_text())
        config.pop('updater_protocol')
        self.config.write_text(json.dumps(config))
        self.a = agent.Agent(self.config)
        self.assertFalse(self.a.status()['enabled'])
        self.assertEqual(self.start()[0], 503)

    def test_http_auth_tampering_replay_restart_and_response_signature(self):
        server = agent.ThreadingHTTPServer(('127.0.0.1', 0), agent.Handler)
        server.agent = self.a
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        url = f'http://127.0.0.1:{server.server_port}'
        nonce, stamp = uuid.uuid4().hex + 'a' * 16, str(int(time.time()))
        digest = hmac.new(self.key.encode(), f'GET\n/v1/status\n{stamp}\n{nonce}\n'.encode(), hashlib.sha256).hexdigest()
        headers = {'X-Update-Time': stamp, 'X-Update-Nonce': nonce, 'X-Update-Signature': digest}
        with urlopen(Request(url + '/v1/status', headers=headers)) as r:
            raw = r.read()
            expected = hmac.new(self.key.encode(), f'{nonce}\n200\n'.encode() + raw, hashlib.sha256).hexdigest()
            self.assertEqual(r.headers['X-Update-Signature'], expected)
        server.agent = agent.Agent(self.config)  # nonce DB survives listener recreation.
        for request in [Request(url + '/v1/status', headers=headers),
                        Request(url + '/v1/start', data=b'{}', headers=headers),
                        Request(url + '/v1/status'),
                        Request(url + '/v1/status', headers={**headers, 'X-Update-Time': '1000000000'})]:
            with self.assertRaises(HTTPError) as context:
                urlopen(request)
            self.assertEqual(context.exception.code, 403)
            context.exception.close()
        self.assertIsNone(self.a.operation())

    def test_latest_endpoint_rejects_prerelease_draft_and_malformed_metadata(self):
        with patch.object(agent, 'urlopen') as fetch:
            response = fetch.return_value.__enter__.return_value
            good = {'tag_name': 'v0.4.0', 'id': 123, 'draft': False, 'prerelease': False}
            response.read.return_value = json.dumps(good).encode()
            self.assertEqual(FETCH_LATEST(), RELEASE)
            for override in [{'draft': True}, {'prerelease': True}, {'tag_name': 'v0.4.0-rc.1'},
                             {'tag_name': 'master'}, {'id': '123'}]:
                response.read.return_value = json.dumps({**good, **override}).encode()
                with self.assertRaises(ValueError):
                    FETCH_LATEST()

    def test_release_change_after_check_requires_new_explicit_click(self):
        self.a.action('check', {'current_version': '0.3.2'})
        self.latest.return_value = {**RELEASE, 'version': '0.4.1', 'tag': 'v0.4.1'}
        self.assertEqual(self.start()[0], 409)
        self.assertIsNone(self.a.operation())
        self.assertFalse((self.root / 'calls').exists())

    def test_stable_release_validation(self):
        for current, allowed in [('0.3.2', True), ('0.4.0-rc.1', True), ('0.4.0', False), ('1.0.0', False)]:
            self.assertEqual(agent.newer('0.4.0', current), allowed)
        for invalid in ['0.4.0-rc.1', 'v0.4.0', '0.04.0', '0.4.0+abc']:
            with self.assertRaises(ValueError): agent.version(invalid, True)

    def test_detached_worker_survives_listener_process_termination(self):
        (self.root / 'hold').touch()
        # Start the operation in another short-lived process, then terminate that
        # parent (the actual worker is a new session with an inherited flock).
        source = f'''
import importlib.util, time
spec=importlib.util.spec_from_file_location('a', {str(ROOT / 'scripts/update_agent.py')!r})
a=importlib.util.module_from_spec(spec); spec.loader.exec_module(a)
a.latest_release=lambda: {RELEASE!r}
agent=a.Agent({str(self.config)!r})
agent.action('start', {{'current_version':'0.3.2','target_version':'0.4.0','request_id':{str(uuid.uuid4())!r}}})
print('started', flush=True)
time.sleep(60)
'''
        parent = subprocess.Popen([sys.executable, '-c', source], stdout=subprocess.PIPE, text=True)
        self.assertEqual(parent.stdout.readline().strip(), 'started')
        parent.terminate()
        parent.wait(timeout=5)
        parent.stdout.close()
        self.a = agent.Agent(self.config)
        self.assertEqual(self.a.operation()['status'], 'running')
        (self.root / 'hold').unlink()
        self.wait('succeeded')
        self.assertEqual(self.amount(), 999)


if __name__ == '__main__':
    unittest.main()
