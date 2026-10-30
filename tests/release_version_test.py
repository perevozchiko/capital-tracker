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

    def test_current_keeps_patch_during_prereleases(self):
        # Matching Budget Tinker: a normal Alpha release advances only the
        # prerelease counter; Patch/Minor/Major are explicit choices.
        current = v('v0.1.6-alpha.1')
        tags = {v('v0.1.5-alpha.1'), current}
        cases = [
            ('current', 'alpha', 'v0.1.6-alpha.2'),
            ('current', 'beta', 'v0.1.6-beta.1'),
            ('current', 'rc', 'v0.1.6-rc.1'),
            ('current', 'stable', 'v0.1.6'),
            ('patch', 'alpha', 'v0.1.7-alpha.1'),
            ('minor', 'alpha', 'v0.2.0-alpha.1'),
            ('major', 'stable', 'v1.0.0'),
        ]
        for mode, stage, expected in cases:
            with self.subTest(mode=mode, stage=stage):
                actual = release.next_version(current, tags, mode, stage)
                self.assertEqual(release.version_string(actual), expected)

    def test_current_retries_prepared_version_without_patch_bump(self):
        # A failed release may have committed an untagged version already.
        # Current + Alpha retries that exact version rather than bumping it.
        current = v('v0.1.6-alpha.1')
        tags = {v('v0.1.5-alpha.1')}
        self.assertEqual(
            release.next_version(current, tags, 'current', 'alpha'), current
        )

    def test_release_workflow_defaults_to_current_like_budget_tinker(self):
        workflow = (PATH.parent.parent / '.github/workflows/release.yml').read_text(
            encoding='utf-8'
        )
        version_selection = workflow.split('      version_bump:', 1)[1].split(
            '      stage:', 1
        )[0]
        self.assertIn('description: "Version: Current, Patch, Minor or Major"', version_selection)
        self.assertIn('default: current', version_selection)
        for option in ('current', 'patch', 'minor', 'major'):
            self.assertIn('          - ' + option, version_selection)
        stage_selection = workflow.split('      stage:', 1)[1].split(
            '\npermissions:', 1
        )[0]
        self.assertIn('default: alpha', stage_selection)
        for stage in ('alpha', 'beta', 'rc', 'stable'):
            self.assertIn(stage, stage_selection)
        self.assertIn('RELEASE_INCREMENT: ${{ inputs.version_bump }}', workflow)
        self.assertNotIn('inputs.increment', workflow)

    def test_real_published_alpha_continues_without_patch_bump(self):
        current = v('v0.1.5-alpha.1')
        tags = {v('v0.1.4-alpha.1'), current}
        candidate = release.next_version(current, tags, 'current', 'alpha')
        self.assertEqual(release.version_string(candidate), 'v0.1.5-alpha.2')

    def test_release_retries_transient_upload_without_new_version(self):
        workflow = (PATH.parent.parent / '.github/workflows/release.yml').read_text(
            encoding='utf-8'
        )
        self.assertIn('id: upload_release', workflow)
        self.assertIn('continue-on-error: true', workflow)
        self.assertIn("if: steps.upload_release.outcome == 'failure'", workflow)
        self.assertIn('overwrite: true', workflow)
        self.assertIn('name: release-${{ matrix.target }}', workflow)
        self.assertIn('needs: [prepare, validate, build]', workflow)

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
