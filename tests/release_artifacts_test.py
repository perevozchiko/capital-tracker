import pathlib
import sys
import tempfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import package_release
import verify_release_artifacts

class ReleaseArtifactTests(unittest.TestCase):
    def test_names(self):
        self.assertEqual(package_release.archive_name('v1.2.3','darwin','arm64'),'CapitalTracker-v1.2.3-macos-arm64.zip')
        self.assertEqual(package_release.archive_name('v1.2.3','linux','amd64'),'CapitalTracker-v1.2.3-linux-amd64.tar.gz')

    def test_missing_packages_prevent_release(self):
        with tempfile.TemporaryDirectory() as d,self.assertRaises(ValueError):
            verify_release_artifacts.verify_all(pathlib.Path(d),'v0.1.3','a'*40)

    def test_workflow_gate_and_exact_commit(self):
        workflow=(ROOT/'.github/workflows/release.yml').read_text()
        self.assertIn('needs: [prepare, validate, build]',workflow)
        self.assertIn('python scripts/verify_release_artifacts.py',workflow)
        self.assertIn('ref: ${{ needs.prepare.outputs.sha }}',workflow)
        self.assertIn('git ls-remote --exit-code --tags',workflow)
        self.assertIn('gh release create',workflow)
        self.assertIn('--verify-tag',workflow)
        self.assertNotIn('on:\n  push:',workflow)

    def test_build_sources_use_authoritative_version(self):
        main=(ROOT/'cmd/capital-tracker/main.go').read_text()
        manual=(ROOT/'.github/workflows/build-macos.yml').read_text()
        self.assertIn('buildinfo.Version',main)
        self.assertNotIn('main.version=0.1.3',manual)
        self.assertNotIn("version:'0.1.3'",(ROOT/'web/js/app.js').read_text())

if __name__=='__main__':
    unittest.main()
