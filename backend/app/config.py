import os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.getenv('FRAMEINSIGHT_DATA', ROOT / '.frameinsight')).resolve()
WORKSPACE = Path(os.getenv('FRAMEINSIGHT_WORKSPACE', ROOT)).resolve()
MODELS = Path(os.getenv('FRAMEINSIGHT_MODELS', ROOT / 'models')).resolve()
for folder in ('originals', 'frames', 'exports', 'backups'):
    (DATA / folder).mkdir(parents=True, exist_ok=True)
DB = DATA / 'projects.sqlite3'

def safe_path(value: str, root: Path) -> Path:
    path = (root / value).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError('File must exist inside the configured workspace')
    return path
