"""Noninteractive CPU image preparation for the upstream terrain model's statistics.
Runs on Modal during image build, never on the Mac. No model weights are loaded.
"""
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import urllib.request
import zipfile

URL = 'https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_bio.zip'
FILES = [f'wc2.1_10m_bio_{n}.tif' for n in (1,4,12,15)]
MAX_ARCHIVE = 128 * 1024 * 1024
MAX_FILE = 32 * 1024 * 1024


def extract_required(archive, destination):
    destination = Path(destination); destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as source:
        for name in FILES:
            info = source.getinfo(name)
            if info.is_dir() or not 0 < info.file_size <= MAX_FILE:
                raise ValueError('Unexpected climate raster size')
            # Read only four exact filenames; never extract arbitrary archive paths.
            with source.open(info) as incoming, (destination / name).open('wb') as outgoing:
                shutil.copyfileobj(incoming, outgoing)


def prepare(root):
    root = Path(root); destination = root / 'data/global'
    if not (destination / 'etopo_10m.tif').is_file():
        raise RuntimeError('Pinned upstream elevation reference is missing')
    with tempfile.TemporaryDirectory() as temporary:
        archive = Path(temporary) / 'worldclim.zip'; digest = hashlib.sha256(); size = 0
        with urllib.request.urlopen(URL) as response, archive.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_ARCHIVE: raise ValueError('Climate archive exceeds preparation limit')
                digest.update(chunk); output.write(chunk)
        extract_required(archive, destination)
    import os
    os.chdir(root)
    from terrain_diffusion.inference.synthetic_map import make_synthetic_map_factory
    make_synthetic_map_factory(seed=1, drop_water_pct=.5)
    stats = destination / 'synthetic_map_stats.json'
    if not stats.is_file(): raise RuntimeError('Terrain statistics were not prepared')
    (destination / 'eduworld-data-provenance.json').write_text(json.dumps({
        'url':URL,'archiveSha256':digest.hexdigest(),'files':FILES,
        'statsSha256':hashlib.sha256(stats.read_bytes()).hexdigest(),
        'scope':'Upstream terrain conditioning statistics; not generated scene geometry'}))


if __name__ == '__main__':
    prepare('/opt/terrain-diffusion')
