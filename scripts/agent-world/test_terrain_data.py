"""Archive handling tests; no dataset download, model or third-party Python imports."""
import importlib.util,io,tempfile,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
s=importlib.util.spec_from_file_location('terrain_data',ROOT/'modal/prepare_terrain_data.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
with tempfile.TemporaryDirectory(dir=ROOT/'.cache',prefix='terrain-data-test-') as folder:
 stream=io.BytesIO()
 with zipfile.ZipFile(stream,'w') as z:
  for name in m.FILES:z.writestr(name,b'fixture raster')
  z.writestr('../unapproved',b'must not be extracted')
 stream.seek(0);m.extract_required(stream,folder)
 assert sorted(p.name for p in Path(folder).iterdir())==sorted(m.FILES)
 empty=io.BytesIO()
 with zipfile.ZipFile(empty,'w') as z:z.writestr(m.FILES[0],b'')
 empty.seek(0)
 try:m.extract_required(empty,folder);raise AssertionError('Empty raster accepted')
 except ValueError:pass
print('PASS: exact climate-file extraction, traversal ignored, empty raster rejection; no downloads or models.')
