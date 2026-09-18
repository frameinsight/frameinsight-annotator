#!/usr/bin/env python3
import json,platform,subprocess,importlib.metadata as md
report={'os':platform.platform(),'python':platform.python_version(),'packages':{}}
for name in ['torch','torchvision','ultralytics','av','fastapi','pydantic','uvicorn','numpy','Pillow']:
    try:report['packages'][name]=md.version(name)
    except md.PackageNotFoundError:report['packages'][name]='not installed'
try:report['nvidia_smi']=subprocess.run(['nvidia-smi'],capture_output=True,text=True,timeout=10).stdout
except Exception as e:report['nvidia_smi']=str(e)
try:
    import torch
    report['cuda']={'available':torch.cuda.is_available(),'runtime':torch.version.cuda,'architectures':torch.cuda.get_arch_list()}
    if torch.cuda.is_available():report['cuda'].update(device=torch.cuda.get_device_name(0),capability=torch.cuda.get_device_capability(0),smoke_test=float(torch.ones(8,device='cuda').sum()))
except Exception as e:report['cuda_error']=str(e)
print(json.dumps(report,indent=2))
