import importlib.util
import io
from pathlib import Path
import tarfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('update_types', Path(__file__).resolve().parents[1] / 'scripts/update-types.py')
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)
FILES = {name: b'declare const example: string;' for name in ('function/index.d.ts', 'function/generate.d.ts', 'iframe/event.d.ts')}


def tar_bytes(files, link=False):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as archive:
        for name, data in files.items():
            item = tarfile.TarInfo(name)
            item.size = len(data)
            archive.addfile(item, io.BytesIO(data))
        if link:
            item = tarfile.TarInfo('function/link.d.ts')
            item.type = tarfile.SYMTYPE
            item.linkname = '../outside'
            archive.addfile(item)
    return stream.getvalue()


class DeclarationArchiveTests(unittest.TestCase):
    def test_current_tar_and_zip_formats(self):
        self.assertEqual(updater.declarations(tar_bytes(FILES)), FILES)
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            for name, data in FILES.items():
                archive.writestr(name, data)
        self.assertEqual(updater.declarations(stream.getvalue()), FILES)

    def test_rejects_traversal_and_non_declarations(self):
        for name in ('../outside.d.ts', '/tmp/outside.d.ts', 'function/../../outside.d.ts', 'function\\outside.d.ts', 'function/code.js'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                updater.declarations(tar_bytes({**FILES, name: b'not a declaration'}))

    def test_rejects_links_and_incomplete_downloads(self):
        with self.assertRaises(ValueError):
            updater.declarations(tar_bytes(FILES, link=True))
        with self.assertRaises(ValueError):
            updater.declarations(tar_bytes({'function/index.d.ts': b'incomplete'}))


if __name__ == '__main__':
    unittest.main()
