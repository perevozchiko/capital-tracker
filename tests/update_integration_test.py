"""Real Go HTTP app → signed Python agent → detached updater → app restart.

All binaries, SQLite files, sessions and ports are private temporary test resources.
No GitHub release, Docker service or production data is changed.
"""
from contextlib import closing
import json
import os
from pathlib import Path
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

if os.name != 'posix':
    raise unittest.SkipTest('The macOS host update agent requires Unix flock')

ROOT = Path(__file__).resolve().parents[1]


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def get(url):
    try:
        response = urlopen(url, timeout=2)
    except HTTPError as error:
        error.close()
        raise
    with response:
        return json.load(response)


def wait_for(callback, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            result = callback()
            if result:
                return result
        except (OSError, ValueError):
            pass
        time.sleep(.03)
    raise AssertionError('temporary deployment did not become ready')


class RealDeploymentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.builds = tempfile.TemporaryDirectory(prefix='capital-update-binaries-')
        cls.current_binary = str(Path(cls.builds.name) / 'current')
        cls.target_binary = str(Path(cls.builds.name) / 'target')
        for version, output in [('0.3.2', cls.current_binary), ('0.4.0', cls.target_binary)]:
            subprocess.run(['go', 'build', '-ldflags', f'-X main.version={version}',
                            '-o', output, './cmd/capital-tracker'], cwd=ROOT, check=True)

    @classmethod
    def tearDownClass(cls):
        cls.builds.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='capital-update-deployment-')
        self.root = Path(self.temp.name)
        self.children = []
        self.addCleanup(self.cleanup)
        key = self.root / 'key'
        key.write_text('a' * 64)
        key.chmod(0o600)
        agent_port, app_port = port(), port()
        self.url = f'http://127.0.0.1:{app_port}'
        self.env = dict(os.environ)
        for name in list(self.env):
            if name.startswith('CAPITAL_TRACKER_'):
                self.env.pop(name)
        self.env.update(CAPITAL_TRACKER_UPDATE_AGENT_URL=f'http://127.0.0.1:{agent_port}',
                        CAPITAL_TRACKER_UPDATE_AGENT_KEY_FILE=str(key))
        config = self.root / 'config.json'
        config.write_text(json.dumps({'listen_port': agent_port, 'state_dir': str(self.root / 'state'),
            'key_file': str(key), 'updater_protocol': 1,
            'updater_argv': [sys.executable, str(ROOT / 'tests/fixtures/update_deployment.py'), str(self.root)]}))
        (self.root / 'deployment.json').write_text(json.dumps({'current_binary': self.current_binary,
            'target_binary': self.target_binary, 'app_port': app_port, 'app_url': self.url, 'env': self.env}))
        source = f'''
import importlib.util
spec=importlib.util.spec_from_file_location('a', {str(ROOT / 'scripts/update_agent.py')!r})
a=importlib.util.module_from_spec(spec); spec.loader.exec_module(a)
a.latest_release=lambda: {{'version':'0.4.0','tag':'v0.4.0','release_id':123,'url':'https://github.com/perevozchiko/capital-tracker/releases/tag/v0.4.0'}}
agent=a.Agent({str(config)!r})
server=a.ThreadingHTTPServer(('127.0.0.1', {agent_port}),a.Handler)
server.agent=agent
server.serve_forever()
'''
        self.agent_source = source
        self.start_agent()
        app = subprocess.Popen([self.current_binary, '--no-browser', '--data-dir', str(self.root / 'data'),
                                '--port', str(app_port)], env=self.env,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.children.append(app)
        (self.root / 'app.pid').write_text(str(app.pid))
        wait_for(lambda: get(self.url + '/api/meta'))
        wait_for(lambda: get(self.url + '/api/update/status')['enabled'])
        (self.root / 'mode').write_text('success')

    def start_agent(self):
        self.agent_process = subprocess.Popen([sys.executable, '-c', self.agent_source],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.children.append(self.agent_process)

    def cleanup(self):
        try:
            os.kill(int((self.root / 'app.pid').read_text()), signal.SIGTERM)
        except (FileNotFoundError, ProcessLookupError):
            pass
        for child in self.children:
            if child.poll() is None:
                child.terminate()
            child.wait(timeout=5)
        self.temp.cleanup()

    def post(self, action, payload):
        return self.write('/api/update/' + action, payload)

    def write(self, path, payload, method='POST'):
        request = Request(self.url + path, method=method, data=json.dumps(payload).encode(),
            headers={'Content-Type': 'application/json', 'X-Capital-Tracker': '1', 'Origin': self.url})
        with urlopen(request, timeout=15) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    def finish(self, expected):
        result = wait_for(lambda: self.terminal_status(), 20)
        self.assertEqual(result['status'], expected, result)
        return result

    def terminal_status(self):
        value = get(self.url + '/api/update/status')['operation']
        return value if value and value['status'] != 'running' else None

    def test_actual_restart_success_and_sqlite_rollback_then_retry(self):
        import uuid
        with closing(sqlite3.connect(self.root / 'data/capital.db')) as db:
            self.assertEqual(db.execute("select value from app_settings where key='theme'").fetchone()[0], 'dark')
        account = self.write('/api/accounts', {'name': 'Temporary savings', 'currency': 'EUR', 'start_month': '2025-01'})
        self.write('/api/months/2025-01', {'balances': [{'account_id': account['id'], 'amount_minor': '12345'}], 'rates': []}, 'PUT')
        before = get(self.url + '/api/data/export')
        before.pop('exported_at')
        self.post('check', {})
        self.assertFalse((self.root / 'calls').exists())
        (self.root / 'mode').write_text('build_error')
        self.post('start', {'target_version': '0.4.0', 'request_id': str(uuid.uuid4())})
        self.finish('failed')
        self.assertEqual(get(self.url + '/api/meta')['version'], '0.3.2')
        (self.root / 'mode').write_text('health_error')
        self.post('start', {'target_version': '0.4.0', 'request_id': str(uuid.uuid4())})
        self.finish('rolled_back')
        self.assertEqual(get(self.url + '/api/meta')['version'], '0.3.2')
        restored = get(self.url + '/api/data/export')
        restored.pop('exported_at')
        self.assertEqual(restored, before)
        with closing(sqlite3.connect(self.root / 'data/capital.db')) as db:
            self.assertEqual(db.execute("select value from app_settings where key='theme'").fetchone()[0], 'dark')
            self.assertEqual(db.execute('pragma integrity_check').fetchone()[0], 'ok')
        (self.root / 'mode').write_text('success')
        self.post('start', {'target_version': '0.4.0', 'request_id': str(uuid.uuid4())})
        result = self.finish('succeeded')
        self.assertEqual(get(self.url + '/api/meta')['version'], '0.4.0')
        self.agent_process.terminate()
        self.agent_process.wait(timeout=5)
        self.start_agent()
        op = wait_for(lambda: get(self.url + '/api/update/status')['operation'])
        self.assertEqual(op['id'], result['id'])
        self.assertEqual(op['status'], 'succeeded')
        with closing(sqlite3.connect(self.root / 'data/capital.db')) as db:
            self.assertEqual(db.execute('pragma integrity_check').fetchone()[0], 'ok')
            self.assertEqual(db.execute("select value from app_settings where key='theme'").fetchone()[0], 'light')
        self.assertEqual(len((self.root / 'calls').read_text().splitlines()), 3)


if __name__ == '__main__':
    unittest.main()
