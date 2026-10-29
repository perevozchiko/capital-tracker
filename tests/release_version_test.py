import importlib.util
import pathlib
import tempfile
import unittest

PATH=pathlib.Path(__file__).resolve().parents[1]/'scripts/release_version.py'
spec=importlib.util.spec_from_file_location('release_version',PATH)
release=importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

def v(text):
    return release.parse(text)

class ReleaseVersionTests(unittest.TestCase):
    def test_increments(self):
        for mode,stage,expected in [('patch','stable','v0.1.4'),('minor','alpha','v0.2.0-alpha.1'),('major','beta','v1.0.0-beta.1')]:
            with self.subTest(mode=mode):
                self.assertEqual(release.version_string(release.next_version(v('0.1.3'),{v('v0.1.3')},mode,stage)),expected)

    def test_stage_transitions_and_numbering(self):
        cases=[('0.1.0-alpha.3','alpha','v0.1.0-alpha.4'),
               ('0.1.0-alpha.4','beta','v0.1.0-beta.1'),
               ('0.1.0-beta.2','rc','v0.1.0-rc.1'),
               ('0.1.0-rc.2','stable','v0.1.0')]
        for current,stage,expected in cases:
            with self.subTest(current=current,stage=stage):
                self.assertEqual(release.version_string(release.next_version(v(current),{v(current)},'current',stage)),expected)

    def test_retry_after_untagged_preparation(self):
        tags={v('0.1.2')}
        self.assertEqual(release.next_version(v('0.1.3-alpha.1'),tags,'current','alpha'),v('0.1.3-alpha.1'))
        self.assertEqual(release.next_version(v('0.1.3'),tags,'current','stable'),v('0.1.3'))

    def test_collision_backward_transition_and_outdated_source(self):
        with self.assertRaisesRegex(ValueError,'already tagged'):
            release.next_version(v('0.1.3'),{v('0.1.3')},'current','stable')
        with self.assertRaisesRegex(ValueError,'downgrade'):
            release.next_version(v('0.1.3-rc.1'),{v('0.1.3-rc.1')},'current','beta')
        with self.assertRaisesRegex(ValueError,'behind'):
            release.next_version(v('0.1.2'),{v('0.1.3')},'patch','stable')

    def test_invalid_versions_and_ordering(self):
        for bad in ['v01.2.3','v1.2','v1.2.3-rc.0','v1.2.3-beta.01','v1.2.3-foo.1','v1.2.3+meta']:
            with self.subTest(bad=bad),self.assertRaises(ValueError):
                v(bad)
        self.assertLess(release.order(v('0.1.0-rc.99')),release.order(v('0.1.0')))

    def test_one_authoritative_version_and_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            f=pathlib.Path(d)/'buildinfo.go'
            f.write_text('package buildinfo\nconst Version = "0.1.3"\n')
            release.write_source(v('0.2.0-beta.1'),f)
            self.assertEqual(release.read_source(f),v('0.2.0-beta.1'))
            release.write_source(v('0.2.0-beta.1'),f)
            self.assertEqual(f.read_text().count('0.2.0-beta.1'),1)
        self.assertEqual(release.parse(release.version_string(release.read_source())),release.read_source())

if __name__ == '__main__':
    unittest.main()
