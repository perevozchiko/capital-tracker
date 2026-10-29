#!/usr/bin/env python3
"""Verify all required archives, package identity, binaries and checksums."""
import argparse
import hashlib
import pathlib
import tarfile
import zipfile

TARGETS=[('darwin','arm64'),('darwin','amd64'),('linux','amd64'),('windows','amd64')]

def verify_one(path,version,sha,goos,arch):
    from package_release import archive_name
    if path.name != archive_name(version,goos,arch) or not path.is_file() or path.stat().st_size == 0:
        raise ValueError(f'Missing or empty release archive: {path}')
    exe='CapitalTracker.exe' if goos == 'windows' else 'CapitalTracker'
    if path.name.endswith('.zip'):
        with zipfile.ZipFile(path) as z:
            if sorted(z.namelist()) != sorted([exe,'BUILD_INFO.txt']):
                raise ValueError(f'Unexpected entries: {path}')
            size=z.getinfo(exe).file_size
            metadata=z.read('BUILD_INFO.txt').decode()
    else:
        with tarfile.open(path,'r:gz') as t:
            files={m.name:m for m in t.getmembers()}
            if sorted(files) != sorted([exe,'BUILD_INFO.txt']):
                raise ValueError(f'Unexpected entries: {path}')
            size=files[exe].size
            metadata=t.extractfile(files['BUILD_INFO.txt']).read().decode()
    if size == 0 or metadata != f'Version: {version}\nCommit: {sha}\nPlatform: {goos}/{arch}\n':
        raise ValueError(f'Invalid release identity or empty binary: {path}')
    checksum=path.with_name(path.name+'.sha256')
    if not checksum.is_file():
        raise ValueError(f'Missing SHA256 file: {path}')
    actual=hashlib.sha256(path.read_bytes()).hexdigest()
    if checksum.read_text().strip() != f'{actual}  {path.name}':
        raise ValueError(f'Checksum mismatch: {path}')

def verify_all(dist,version,sha):
    from package_release import archive_name
    expected=set()
    for goos,arch in TARGETS:
        name=archive_name(version,goos,arch)
        verify_one(dist/name,version,sha,goos,arch)
        expected.update([name,name+'.sha256'])
    actual={p.name for p in dist.iterdir() if p.is_file()}
    if actual != expected:
        raise ValueError(f'Unexpected or missing files: {actual ^ expected}')

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--version',required=True)
    p.add_argument('--sha',required=True)
    p.add_argument('--dist',default='dist')
    a=p.parse_args()
    verify_all(pathlib.Path(a.dist),a.version,a.sha)
    print('Verified four platform packages and matching checksums')

if __name__ == '__main__':
    main()
