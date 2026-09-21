import importlib.util
import os
from pathlib import Path
import secrets
import stat
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('credentials', Path(__file__).with_name('marketplace-credentials.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CredentialPreparationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'environment'
        self.secret = secrets.token_urlsafe(32)

    def prepare_file(self, content):
        self.path.write_text(content)
        self.path.chmod(0o600)

    def test_replacement_preserves_application_keys_and_keeps_mock(self):
        vault = secrets.token_urlsafe(32)
        self.prepare_file(f'TOKEN_ENCRYPTION_KEY={vault}\nML_APP_ID=\nML_SECRET_KEY=\nMARKETPLACE_SOURCE=MERCADO_LIVRE\n')
        module.prepare(self.path, '123456789', self.secret)
        fields = dict(line.split('=', 1) for line in self.path.read_text().splitlines())
        self.assertTrue(fields['TOKEN_ENCRYPTION_KEY'] == vault, 'Vault key must be preserved')
        self.assertTrue(fields['ML_SECRET_KEY'] == self.secret, 'Replacement secret must be stored')
        self.assertEqual(fields['MARKETPLACE_SOURCE'], 'MOCK')
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)

    def test_duplicate_old_keys_are_removed(self):
        self.prepare_file('ML_SECRET_KEY=old\nML_SECRET_KEY=stale\nMARKETPLACE_SOURCE=MOCK\nMARKETPLACE_SOURCE=MERCADO_LIVRE\n')
        module.prepare(self.path, '123456789', self.secret)
        lines = self.path.read_text().splitlines()
        self.assertEqual(sum(line.startswith('ML_SECRET_KEY=') for line in lines), 1)
        self.assertEqual(sum(line.startswith('MARKETPLACE_SOURCE=') for line in lines), 1)
        self.assertNotIn('stale', self.path.read_text())

    def test_invalid_value_preserves_original(self):
        self.prepare_file('MARKETPLACE_SOURCE=MOCK\n')
        original = self.path.read_bytes()
        with self.assertRaises(ValueError):
            module.prepare(self.path, '123456789', 'invalid\nvalue')
        self.assertEqual(self.path.read_bytes(), original)

    def test_public_permissions_and_symlink_are_rejected(self):
        self.prepare_file('MARKETPLACE_SOURCE=MOCK\n')
        self.path.chmod(0o644)
        with self.assertRaises(ValueError):
            module.prepare(self.path, '123456789', self.secret)
        self.path.chmod(0o600)
        linked = self.path.with_name('linked')
        os.symlink(self.path, linked)
        with self.assertRaises(ValueError):
            module.prepare(linked, '123456789', self.secret)


if __name__ == '__main__':
    unittest.main()
