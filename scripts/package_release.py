#!/usr/bin/env python3
"""Build a self-contained, versioned archive from the exact release revision."""
import argparse
import hashlib
import io
import os
import pathlib
import subprocess
import tarfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]

def archive_name(version, goos, arch):
    platform = {'darwin':'macos', 'linux':'linux', 'windows':'windows'}[goos]
    extension = '.tar.gz' if goos == 'linux' else '.zip'
    return f'CapitalTracker-{version}-{platform}-{arch}{extension}'

def make_package(goos, arch, version, sha, dest, build=True):
    if (goos, arch) not in [('darwin','arm64'),('darwin','amd64'),('linux','amd64'),('windows','amd64')]:
        raise ValueError('Unsupported release target')
    if len(sha) != 40 or any(c not in '0123456789abcdef' for c in sha.lower()):
        raise ValueError('Expected full 40-character Git SHA')
    from release_version import parse, read_source
    if parse(version) != read_source():
        raise ValueError('Release version does not match authoritative Go version')
    dest.mkdir(parents=True, exist_ok=True)
    exe = 'CapitalTracker.exe' if goos == 'windows' else 'CapitalTracker'
    binary = dest / exe
    if build:
        subprocess.run(['go','build','-trimpath','-ldflags',
            f'-s -w -X github.com/perevozchiko/capital-tracker/internal/buildinfo.Commit={sha}',
            '-o',str(binary),'./cmd/capital-tracker'],cwd=ROOT,check=True,
            env={**os.environ,'GOOS':goos,'GOARCH':arch,'CGO_ENABLED':'0'})
    if not binary.is_file() or binary.stat().st_size == 0:
        raise ValueError('Build output missing or empty')
    metadata = f'Version: {version}\nCommit: {sha}\nPlatform: {goos}/{arch}\n'
    name = archive_name(version,goos,arch)
    path = dest / name
    if name.endswith('.zip'):
        with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as z:
            z.write(binary,exe)
            z.writestr('BUILD_INFO.txt',metadata)
    else:
        with tarfile.open(path,'w:gz') as t:
            t.add(binary,arcname=exe)
            raw = metadata.encode()
            info = tarfile.TarInfo('BUILD_INFO.txt')
            info.size = len(raw)
            info.mode = 0o644
            t.addfile(info,io.BytesIO(raw))
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    path.with_name(name+'.sha256').write_text(f'{digest}  {name}\n')
    from verify_release_artifacts import verify_one
    verify_one(path,version,sha,goos,arch)
    binary.unlink()
    return path

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--os',choices=['darwin','linux','windows'],required=True)
    parser.add_argument('--arch',choices=['arm64','amd64'],required=True)
    parser.add_argument('--version',required=True)
    parser.add_argument('--sha',required=True)
    parser.add_argument('--dist',default='dist')
    a=parser.parse_args()
    print(make_package(a.os,a.arch,a.version,a.sha,ROOT/a.dist))

if __name__ == '__main__':
    main()
