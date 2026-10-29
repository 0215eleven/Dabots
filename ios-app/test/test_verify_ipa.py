import json
import plistlib
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/verify-ipa.py'


class VerifyIpaTests(unittest.TestCase):
    def setUp(self):
        self.area = tempfile.TemporaryDirectory(prefix='pro-ipa-')
        self.addCleanup(self.area.cleanup)
        self.ipa = Path(self.area.name) / 'app.ipa'
        self.root = 'Payload/DeepSeekBotPro.app/'

    def archive(self, *, executable=True, info=True, extra=None, binary=b'\xcf\xfa\xed\xfe' + bytes(28)):
        with zipfile.ZipFile(self.ipa, 'w', zipfile.ZIP_DEFLATED) as archive:
            if info:
                archive.writestr(self.root + 'Info.plist', plistlib.dumps({
                    'CFBundleIdentifier': 'app.dsbot.mobile',
                    'CFBundleExecutable': 'DeepSeekBotPro',
                    'CFBundlePackageType': 'APPL',
                }))
            if executable:
                archive.writestr(self.root + 'DeepSeekBotPro', binary)
            for name, data in (extra or {}).items():
                archive.writestr(name, data)

    def run_validator(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), str(self.ipa), *args], capture_output=True, text=True)

    def refused(self, fragment):
        result = self.run_validator('--bundle-id', 'app.dsbot.mobile')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn(fragment, result.stderr)

    def test_valid_lite_archive_reports_its_bundle_and_checksum(self):
        self.archive()
        result = self.run_validator('--bundle-id', 'app.dsbot.mobile')
        self.assertEqual(result.returncode, 0, result.stderr)
        info = json.loads(result.stdout)
        self.assertEqual(info['bundleIdentifier'], 'app.dsbot.mobile')
        self.assertEqual(info['app'], 'Payload/DeepSeekBotPro.app')
        self.assertEqual(info['size'], self.ipa.stat().st_size)
        self.assertRegex(info['sha256'], r'^[0-9a-f]{64}$')

    def test_truncated_zip_cannot_be_reported_as_a_valid_ipa(self):
        self.archive()
        self.ipa.write_bytes(self.ipa.read_bytes()[:-20])
        self.refused('ZIP')

    def test_an_archive_without_a_payload_app_is_refused(self):
        with zipfile.ZipFile(self.ipa, 'w') as archive:
            archive.writestr('readme.txt', 'no app')
        self.refused('Payload')

    def test_missing_plist_is_refused(self):
        self.archive(info=False)
        self.refused('Info.plist')

    def test_missing_executable_is_refused(self):
        self.archive(executable=False)
        self.refused('executable')

    def test_a_text_file_cannot_masquerade_as_the_native_executable(self):
        self.archive(binary=b'not a native executable')
        self.refused('Mach-O')

    def test_signing_material_cannot_ship_as_an_unsigned_build(self):
        for name in ['_CodeSignature/CodeResources', 'embedded.mobileprovision']:
            with self.subTest(name=name):
                self.archive(extra={self.root + name: b'synthetic signing marker'})
                self.refused('unsigned')

    def test_extensions_cannot_ship_in_the_lite_build(self):
        self.archive(extra={self.root + 'PlugIns/Widget.appex/Info.plist': b'fixture'})
        self.refused('lite')

    def test_a_different_installation_identity_is_refused(self):
        self.archive()
        result = self.run_validator('--bundle-id', 'app.other.mobile')
        self.assertEqual(result.returncode, 2)
        self.assertIn('bundle identifier', result.stderr)

    def test_unsafe_archive_paths_are_refused(self):
        self.archive(extra={'../outside': b'fixture'})
        self.refused('unsafe')


if __name__ == '__main__':
    unittest.main()
