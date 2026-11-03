"""TEMPORARY TEST DEPLOYMENT ONLY. Implements the host updater's v1 contract.

Used by update_integration_test.py. No Docker commands or production paths.
"""
from contextlib import closing
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import time
import threading
from urllib.request import urlopen


def main():
    request = json.loads(sys.stdin.readline())
    root = Path(sys.argv[1])
    config = json.loads((root / 'deployment.json').read_text())
    mode = (root / 'mode').read_text()
    target = request['release']['version']
    data = root / 'data'
    db_path = data / 'capital.db'
    backup_path = root / f"{request['operation_id']}.db"
    with (root / 'calls').open('a') as stream:
        stream.write(request['operation_id'] + '\n')

    def emit(**event):
        print(json.dumps(event), flush=True)

    def stage(value):
        emit(event='stage', stage=value)

    def stop_app():
        pid = int((root / 'app.pid').read_text())
        os.kill(pid, signal.SIGTERM)
        # Wait for the real application's SQLite OS lock to be released by exit.
        for _ in range(200):
            import fcntl
            with (data / '.capital-tracker.lock').open('a+') as lock:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    return
                except BlockingIOError:
                    pass
            time.sleep(.02)
        raise RuntimeError('app did not exit')

    def start_app(binary):
        with (root / 'app.log').open('ab') as log:
            process = subprocess.Popen([binary, '--no-browser', '--data-dir', str(data),
                                        '--port', str(config['app_port'])],
                                       env=config['env'], stdin=subprocess.DEVNULL,
                                       stdout=log, stderr=log, start_new_session=True)
        (root / 'app.pid').write_text(str(process.pid))
        # Parent worker owns the short-lived Popen, while the long-lived app is
        # intentionally detached. The harness reaps it where supported.
        return process

    def healthy(expected):
        for _ in range(200):
            try:
                with urlopen(config['app_url'] + '/api/meta', timeout=.2) as response:
                    meta = json.load(response)
                if meta['version'] == expected:
                    with closing(sqlite3.connect(db_path)) as db:
                        return db.execute('pragma integrity_check').fetchone()[0] == 'ok'
            except (OSError, ValueError):
                pass
            time.sleep(.02)
        return False

    for phase in ['build', 'test', 'backup', 'sqlite_check', 'switch', 'health_check']:
        stage(phase)
        if phase == 'build':
            if mode == 'build_error':
                emit(event='result', outcome='failed')
                return 1
            # Real Go binaries were built from this checkout by the test harness.
            assert Path(config['target_binary']).is_file()
        elif phase == 'test':
            assert target == '0.4.0'
        elif phase == 'backup':
            # Quiesce first, preserving the final SQLite and auth state.
            stop_app()
            with closing(sqlite3.connect(db_path)) as db:
                with closing(sqlite3.connect(backup_path)) as backup:
                    db.backup(backup)
        elif phase == 'sqlite_check':
            with closing(sqlite3.connect(backup_path)) as backup:
                assert backup.execute('pragma integrity_check').fetchone()[0] == 'ok'
        elif phase == 'switch':
            with closing(sqlite3.connect(db_path)) as db, db:
                db.execute("update app_settings set value='light' where key='theme'")
            running = start_app(config['target_binary'])
        elif phase == 'health_check':
            if mode != 'health_error' and healthy(target):
                emit(event='result', outcome='succeeded', verified_version=target)
                # Avoid a Popen destructor warning for the intentionally detached app.
                threading.Thread(target=running.wait, daemon=True).start()
                return 0
            stage('rollback')
            stop_app()
            running.wait(timeout=5)
            with closing(sqlite3.connect(backup_path)) as backup:
                with closing(sqlite3.connect(db_path)) as db:
                    backup.backup(db)
            restored = start_app(config['current_binary'])
            assert healthy(request['current_version'])
            threading.Thread(target=restored.wait, daemon=True).start()
            emit(event='result', outcome='rolled_back', verified_version=request['current_version'])
            return 1


if __name__ == '__main__':
    sys.exit(main())
