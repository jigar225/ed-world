"""Explicit one-tile GPU qualification through the same funded production bridge."""
import argparse,asyncio,json
from pathlib import Path
import modal_generate as bridge
import modal_reason as ledger
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--execute',action='store_true');args=parser.parse_args()
ledger.SOURCE_FILES=bridge.SOURCE_FILES
plan={'version':1,'assetId':'terrain-smoke','domain':'Earth','representation':'heightfield',
 'extentMeters':[960,960],'elevationRangeMeters':[-20000,100000],
 'conditioning':{'width':2,'height':2,'elevations':[100,250,120,300]},
 'landforms':['undulating terrain'],'surfaceMaterials':['not generated in this check'],'waterRegions':[],
 'evidenceIds':[],'generationPrompt':'Native elevation-grid execution check only',
 'closeupRequirements':[],'limitations':['GPU qualification only; no lesson or visual-quality acceptance']}
request={'job':'terrain-smoke-'+ledger.service_source_hash()[:16],'kind':'terrain','payload':{'plan':plan,'seed':41}}
result=asyncio.run(bridge.run(request,args.execute))
output=json.loads((bridge.ROOT/result['path']).read_text())
assert output['width']==33 and output['height']==33 and len(output['elevations'])==1089
assert output['extentMeters']==[960,960] and output['provenance']['kind']=='model-generated'
report={'passed':True,'result':result,'width':33,'height':33,'minimumElevation':min(output['elevations']),'maximumElevation':max(output['elevations']),'scope':'Actual terrain inference, not a complete learning world'}
(bridge.ROOT/'.cache/agent-world/terrain-smoke-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
