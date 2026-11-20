"""Model-file downloads (taber_ml.weights) against a local HTTP server, and the CUDA build check."""

from __future__ import annotations

import hashlib
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from taber_ml import weights
from taber_ml.device import _supported

BODY = bytes(range(256)) * 4096  # 1 MiB


class _Server:
    """Serves BODY at /file. ``cut_after``: the first response closes after that many bytes (a dropped link)."""

    def __init__(self, ranges: bool = True, cut_after: int | None = None):
        self.ranges, self.cut_after, self.requests = ranges, cut_after, []
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):  # quiet
                pass

            def do_GET(self):
                rng = self.headers.get("Range")
                outer.requests.append(rng)
                start = int(rng.split("=")[1].rstrip("-")) if rng and outer.ranges else 0
                if start >= len(BODY):
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{len(BODY)}")
                    self.end_headers()
                    return
                body = BODY[start:]
                self.send_response(206 if start else 200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if outer.cut_after is not None:
                    n, outer.cut_after = outer.cut_after, None
                    self.wfile.write(body[:n])
                    self.wfile.flush()
                    self.connection.close()  # the client sees a short read
                    return
                self.wfile.write(body)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}/file"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()


@pytest.fixture(autouse=True)
def _fast_retries(monkeypatch):
    monkeypatch.setattr(weights.time, "sleep", lambda s: None)


def test_download_resumes_after_a_dropped_connection(tmp_path):
    srv = _Server(cut_after=300_000)
    seen: list[tuple[int, int]] = []
    try:
        out = weights.download(srv.url, tmp_path / "m.bin", len(BODY), lambda d, t: seen.append((d, t)),
                               sha256_prefix=hashlib.sha256(BODY).hexdigest()[:8], timeout=5)
    finally:
        srv.close()
    assert out.read_bytes() == BODY
    assert srv.requests[0] is None and srv.requests[1] == "bytes=300000-"  # second attempt asks for the rest
    assert seen[-1] == (len(BODY), len(BODY))
    assert not (tmp_path / "m.bin.part").exists()


def test_download_starts_over_when_the_server_ignores_ranges(tmp_path):
    srv = _Server(ranges=False, cut_after=300_000)
    try:
        out = weights.download(srv.url, tmp_path / "m.bin", len(BODY), timeout=5)
    finally:
        srv.close()
    assert out.read_bytes() == BODY


def test_a_complete_part_file_is_accepted(tmp_path):
    (tmp_path / "m.bin.part").write_bytes(BODY)  # finished last time, the rename did not happen
    srv = _Server()
    try:
        out = weights.download(srv.url, tmp_path / "m.bin", len(BODY), timeout=5)
    finally:
        srv.close()
    assert out.read_bytes() == BODY and srv.requests == [f"bytes={len(BODY)}-"]


def test_a_damaged_file_is_rejected_and_removed(tmp_path):
    srv = _Server()
    try:
        with pytest.raises(weights.WeightsError, match="damaged"):
            weights.download(srv.url, tmp_path / "m.bin", len(BODY), sha256_prefix="00000000", timeout=5)
    finally:
        srv.close()
    assert not (tmp_path / "m.bin").exists() and not (tmp_path / "m.bin.part").exists()


def test_an_unreachable_server_fails_instead_of_waiting(tmp_path):
    with pytest.raises(weights.WeightsError):
        weights.download("http://127.0.0.1:9/none", tmp_path / "m.bin", 10, attempts=2, timeout=2)


def test_weights_land_where_the_libraries_look(monkeypatch, tmp_path):
    monkeypatch.setenv("TORCH_HOME", str(tmp_path / "torch"))
    monkeypatch.setenv("TABER_CACHE_DIR", str(tmp_path / "taber"))
    assert weights.WEIGHTS["demucs"].path == tmp_path / "torch" / "hub" / "checkpoints" / "5c90dfd2-34c22ccb.th"
    assert weights.WEIGHTS["beat_this"].path.name == "beat_this-final0.ckpt"
    assert weights.WEIGHTS["hands"].path == tmp_path / "taber" / "models" / "hand_landmarker.task"


@pytest.mark.parametrize(
    ("cap", "archs", "ok"),
    [
        ((6, 1), ["sm_75", "sm_80", "sm_86", "sm_90", "sm_100", "sm_120"], False),  # GTX 1060 on a CUDA 13 build
        ((7, 5), ["sm_75", "sm_80", "sm_86", "sm_90", "sm_100", "sm_120"], True),
        ((8, 9), ["sm_75", "sm_80", "sm_86", "sm_90"], True),  # sm_86 binaries run on 8.9
        ((12, 1), ["sm_75", "sm_90", "compute_90"], True),  # newer card: the driver compiles the PTX
        ((12, 0), ["sm_75", "sm_90"], False),
        ((5, 2), [], True),  # unknown build: the test kernel decides
    ],
)
def test_cuda_build_support(cap, archs, ok):
    assert _supported(cap, archs) is ok
