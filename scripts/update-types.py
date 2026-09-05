"""Synchronize editor declarations from Tavern Helper; runtime code is untouched."""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
URL = 'https://gitlab.com/novi028/JS-Slash-Runner/-/raw/main/dist/@types.zip'


def declarations(data):
    files = {}

    def add(name, content):
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or '\\' in name:
            raise ValueError(f'Unsafe declaration path: {name}')
        normalized = path.as_posix()
        if not normalized.startswith(('function/', 'iframe/')) or not normalized.endswith('.d.ts'):
            raise ValueError(f'Unexpected declaration: {name}')
        content.decode('utf-8')
        if not content or normalized in files:
            raise ValueError(f'Empty or duplicate declaration: {name}')
        files[normalized] = content

    stream = io.BytesIO(data)
    if zipfile.is_zipfile(stream):
        with zipfile.ZipFile(stream) as archive:
            for item in archive.infolist():
                if not item.is_dir():
                    add(item.filename, archive.read(item))
    else:
        stream.seek(0)
        with tarfile.open(fileobj=stream, mode='r:*') as archive:
            for item in archive:
                if item.isdir():
                    continue
                if not item.isfile():
                    raise ValueError(f'Unexpected archive entry: {item.name}')
                add(item.name, archive.extractfile(item).read())
    for required in ('function/index.d.ts', 'function/generate.d.ts', 'iframe/event.d.ts'):
        if required not in files:
            raise ValueError(f'Missing declaration: {required}')
    return files


def main():
    with urllib.request.urlopen(URL, timeout=60) as response:
        data = response.read(20 * 1024 * 1024 + 1)
    if len(data) > 20 * 1024 * 1024:
        raise ValueError('Declaration archive exceeds 20 MiB')
    files = declarations(data)  # Validate the entire archive before changing local files.
    destination = ROOT / '@types'
    updated = 0
    for name, content in files.items():
        target = destination / name
        if not target.exists() or target.read_bytes().replace(b'\r\n', b'\n') != content.replace(b'\r\n', b'\n'):
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            updated += 1
    removed = 0
    for directory in ('function', 'iframe'):
        for target in (destination / directory).rglob('*.d.ts'):
            if target.relative_to(destination).as_posix() not in files:
                target.unlink()
                removed += 1
    report = {'source': URL, 'archiveSha256': hashlib.sha256(data).hexdigest(), 'files': len(files), 'updated': updated, 'removed': removed}
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
