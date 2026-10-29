#!/usr/bin/env python3
"""Calculate safe SemVer transitions using source version and all Git tags."""
import argparse
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / 'internal/buildinfo/buildinfo.go'
SEMVER = re.compile(r'^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.([1-9]\d*))?$')
SOURCE = re.compile(r'(?m)^const Version = "([^"]+)"$')
STAGES = {'alpha': 0, 'beta': 1, 'rc': 2, 'stable': 3}

def parse(value):
    match = SEMVER.fullmatch(value)
    if not match:
        raise ValueError(f'Invalid SemVer: {value}')
    major, minor, patch, stage, n = match.groups()
    return int(major), int(minor), int(patch), stage or 'stable', int(n or 0)

def version_string(value):
    major, minor, patch, stage, n = value
    return f'v{major}.{minor}.{patch}' + (f'-{stage}.{n}' if stage != 'stable' else '')

def order(value):
    major, minor, patch, stage, n = value
    return major, minor, patch, STAGES[stage], n

def read_source(path=VERSION_FILE):
    data = path.read_text(encoding='utf-8')
    matches = SOURCE.findall(data)
    if len(matches) != 1:
        raise ValueError('Expected exactly one const Version in buildinfo.go')
    return parse(matches[0])

def write_source(value, path=VERSION_FILE):
    data = path.read_text(encoding='utf-8')
    if len(SOURCE.findall(data)) != 1:
        raise ValueError('Version source is missing or ambiguous')
    updated = SOURCE.sub('const Version = "' + version_string(value)[1:] + '"', data)
    if updated != data:
        path.write_text(updated, encoding='utf-8')

def git_tags():
    output = subprocess.check_output(['git', 'tag', '--list'], cwd=ROOT, text=True)
    tags = set()
    for tag in output.splitlines():
        if re.match(r'^v\d', tag):
            tags.add(parse(tag))
    return tags

def next_version(current, tags, mode, stage):
    if mode not in ('current', 'patch', 'minor', 'major') or stage not in STAGES:
        raise ValueError('Unknown release option')
    known = set(tags)
    latest = max(known, key=order) if known else None
    if latest is not None and order(current) < order(latest):
        raise ValueError('Version source is behind a published Git tag')
    anchor = current
    major, minor, patch, old_stage, old_n = anchor
    if mode == 'patch':
        patch += 1
    elif mode == 'minor':
        minor, patch = minor + 1, 0
    elif mode == 'major':
        major, minor, patch = major + 1, 0, 0
    if mode != 'current':
        candidate = major, minor, patch, stage, (0 if stage == 'stable' else 1)
    elif STAGES[stage] < STAGES[old_stage]:
        raise ValueError('Cannot downgrade prerelease stage; select Patch, Minor or Major')
    elif stage == old_stage:
        if anchor not in known:
            candidate = anchor  # Retry a prepared version without a tag.
        elif stage == 'stable':
            raise ValueError('Stable version already tagged; select Patch, Minor or Major')
        else:
            candidate = major, minor, patch, stage, old_n + 1
    else:
        candidate = major, minor, patch, stage, (0 if stage == 'stable' else 1)
    if candidate in known or (latest is not None and order(candidate) <= order(latest)):
        raise ValueError('Version is already tagged or older than the latest tag')
    return candidate

def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('show')
    plan = sub.add_parser('plan')
    plan.add_argument('--mode', choices=['current','patch','minor','major'], required=True)
    plan.add_argument('--stage', choices=list(STAGES), required=True)
    apply = sub.add_parser('apply')
    apply.add_argument('version')
    args = parser.parse_args()
    if args.command == 'show':
        print(version_string(read_source()))
    elif args.command == 'plan':
        print(version_string(next_version(read_source(), git_tags(), args.mode, args.stage)))
    else:
        candidate = parse(args.version)
        write_source(candidate)
        if read_source() != candidate:
            raise ValueError('Version write could not be verified')
        print(version_string(candidate))

if __name__ == '__main__':
    main()
