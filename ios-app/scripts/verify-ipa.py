#!/usr/bin/env python3
"""Validate the unsigned lite IPA and report artifact identity without extracting it."""
import argparse
import hashlib
import json
import plistlib
import sys
import zipfile
from pathlib import Path, PurePosixPath
from xml.parsers.expat import ExpatError


def verify(path, bundle_id=None):
    try:
        with zipfile.ZipFile(path) as archive:
            if archive.testzip() is not None:
                raise ValueError('Invalid ZIP: entry checksum failed')
            names = set(archive.namelist())
            for name in names:
                if '\\' in name or name.startswith('/') or '..' in PurePosixPath(name).parts:
                    raise ValueError('Invalid ZIP: unsafe entry path')
            apps = {tuple(PurePosixPath(name).parts[:2]) for name in names
                    if len(PurePosixPath(name).parts) >= 2
                    and PurePosixPath(name).parts[0] == 'Payload'
                    and PurePosixPath(name).parts[1].endswith('.app')}
            if len(apps) != 1:
                raise ValueError('IPA must contain exactly one Payload application')
            app = '/'.join(next(iter(apps)))
            try:
                info = plistlib.loads(archive.read(app + '/Info.plist'))
            except (KeyError, plistlib.InvalidFileException, ValueError, ExpatError) as error:
                raise ValueError('Missing or invalid Info.plist') from error
            if not isinstance(info, dict):
                raise ValueError('Invalid Info.plist dictionary')
            if not isinstance(info.get('CFBundleIdentifier'), str) or not info['CFBundleIdentifier']:
                raise ValueError('Missing bundle identifier')
            if bundle_id is not None and info['CFBundleIdentifier'] != bundle_id:
                raise ValueError('Unexpected bundle identifier')
            executable = info.get('CFBundleExecutable')
            if not isinstance(executable, str) or not executable or executable in ('.', '..') or '/' in executable or '\\' in executable:
                raise ValueError('Invalid executable name')
            try:
                with archive.open(app + '/' + executable) as binary:
                    magic = binary.read(4)
            except KeyError as error:
                raise ValueError('Missing native executable') from error
            if magic not in (b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xfe\xed\xfa\xce', b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf'):
                raise ValueError('Native executable is not Mach-O')
            if app + '/embedded.mobileprovision' in names or any(name.startswith(app + '/_CodeSignature/') for name in names):
                raise ValueError('Expected an unsigned main application')
            if any(name.startswith(app + '/PlugIns/') for name in names):
                raise ValueError('The lite IPA must not contain extensions')
    except (zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError) as error:
        raise ValueError('Invalid ZIP archive') from error
    digest = hashlib.sha256()
    with path.open('rb') as data:
        for block in iter(lambda: data.read(1024 * 1024), b''):
            digest.update(block)
    return {'filename': path.name, 'app': app, 'bundleIdentifier': info['CFBundleIdentifier'],
            'size': path.stat().st_size, 'sha256': digest.hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ipa', type=Path)
    parser.add_argument('--bundle-id')
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.ipa, args.bundle_id)))
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
