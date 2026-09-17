"""Regression for Modal's class parameter hydration. Source-only; never deploys/invokes."""
import importlib.util,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]
s=importlib.util.spec_from_file_location('terrain_app',root/'modal/terrain_app.py')
m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m)
lease='00000000-0000-0000-0000-000000000001'
for cls in (m.Terrain,sys.modules['agent_generation'].Reference,sys.modules['agent_generation'].Object):
 instance=cls(lease_id=lease,credit_cents=100)
 assert instance.lease_id==lease and instance.credit_cents==100
print('PASS: SDK parameter hydration for terrain/reference/object; no deployment, model loading or remote calls.')
