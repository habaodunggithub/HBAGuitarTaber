"""Write the API's OpenAPI schema to apps/web/openapi.json (no server needed)."""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "api"))
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402

with tempfile.TemporaryDirectory() as d:
    app = create_app(Settings(data_dir=Path(d), worker_token="x" * 20, spa_dir=Path(d) / "none", reaper_interval_s=3600))
    out = Path(__file__).resolve().parents[1] / "apps" / "web" / "openapi.json"
    out.write_text(json.dumps(app.openapi(), indent=1))
    print("wrote", out)
