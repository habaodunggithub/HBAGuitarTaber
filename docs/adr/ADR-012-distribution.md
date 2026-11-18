# ADR-012: Phát hành qua GitHub Releases, trang tải trên GitHub Pages, build bằng GitHub Actions

**Status:** Proposed · **Date:** 2026-11-18 · **Deciders:** HABAO

## Context

Cần một trang công khai để mọi người tải bộ cài desktop (ADR-011), chỉ dùng hạ tầng của GitHub. Repo `HBAGuitarTaber`
đang public. Bộ cài có kích thước ~150–250 MB mỗi nền tảng; runtime Python được tải riêng ở lần chạy đầu.

Giới hạn của GitHub (theo tài liệu của GitHub, cần kiểm tra lại khi chính sách đổi):

| Dịch vụ | Giới hạn | Hệ quả |
|---|---|---|
| GitHub Pages | site ≤ 1 GB, băng thông mềm ~100 GB/tháng, không dành cho phân phối file lớn | **Không** đặt bộ cài trên Pages |
| GitHub Releases | mỗi file ≤ 2 GiB, không giới hạn băng thông công bố | Bộ cài nằm ở Releases |
| GitHub Actions | miễn phí cho repo public, có runner Windows / macOS arm64 / Ubuntu | Build gốc trên từng OS, không cross-compile |
| REST API không xác thực | 60 request/giờ/IP | Trang không gọi API mỗi lần tải; dùng `latest.json` sinh lúc deploy |

## Decision

- **`.github/workflows/desktop.yml`**: chạy khi push tag `v*` (hoặc bấm tay). Ma trận `windows-latest`, `macos-14` (arm64), `ubuntu-22.04`
  (glibc 2.35, chạy được trên phần lớn distro hiện hành). Mỗi job: build SPA → stage (wheel, requirements theo biến thể, uv, FFmpeg) →
  **smoke test thật** (cài runtime `cpu`, chạy API + worker, upload một file m4a, đợi tab) → `electron-builder`. Job cuối tạo **Release nháp**
  kèm `SHA256SUMS.txt`; bạn kiểm tra rồi bấm Publish.
- **`.github/workflows/pages.yml`**: chạy khi push `site/**` lên `main` và khi một Release được publish. Sinh `site/latest.json`
  từ Release mới nhất (tên file, kích thước, link), rồi deploy bằng `actions/deploy-pages`. Trang đọc `latest.json`; nếu lỗi thì gọi REST API; nếu vẫn lỗi thì trỏ về trang Releases.
- Định dạng bộ cài: Windows `.exe` (NSIS, cài cho người dùng hiện tại, không cần quyền admin), macOS `.dmg` (arm64), Linux `.AppImage` và `.deb`.

## Options Considered

### Option A: Releases + Pages + Actions (chọn)

| Dimension | Assessment |
|---|---|
| Complexity | Thấp: 2 workflow, trang tĩnh |
| Cost | 0 đồng với repo public |
| Scalability | Băng thông Releases đủ cho dự án cá nhân/cộng đồng |
| Team familiarity | Cao: đã dùng GitHub |

**Pros:** một nơi duy nhất cho mã, bản build, trang tải; link tải ổn định (`/releases/latest/download/<file>`); checksum công khai.
**Cons:** chưa có ký mã nên vẫn hiện cảnh báo của hệ điều hành; build macOS trên Actions chậm hơn (FFmpeg phải tự build, có cache).

### Option B: Pages + bộ cài trên Cloudflare R2 / S3

| Dimension | Assessment |
|---|---|
| Complexity | TB: thêm credential và bucket |
| Cost | R2 miễn phí egress nhưng tính tiền lưu trữ; S3 tính egress |
| Scalability | Cao |
| Team familiarity | TB |

**Pros:** kiểm soát CDN, tên miền riêng.
**Cons:** thêm một hệ thống phải giữ credential; trái với yêu cầu "dùng chức năng của GitHub".

### Option C: itch.io / SourceForge

| Dimension | Assessment |
|---|---|
| Complexity | Thấp |
| Cost | 0 đồng |
| Scalability | Tốt |
| Team familiarity | Thấp |

**Pros:** có sẵn trang tải.
**Cons:** tách khỏi GitHub; giao diện và quảng cáo không do mình quyết định.

## Trade-off Analysis

Pages không dành để phát file lớn, còn Releases thì không có trang giới thiệu. Ghép hai thứ lại thì mỗi bên làm đúng việc của mình. Build gốc trên từng runner tốn thời gian hơn cross-compile, nhưng mua được một smoke test chạy thật trên Windows và macOS, hai nơi mà máy dev (CachyOS) không kiểm được.

## Consequences

- **Dễ hơn:** phát hành = `git tag v0.2.0 && git push --tags`, kiểm Release nháp, Publish; trang tải tự cập nhật.
- **Khó hơn:** mỗi Release mất ~25–40 phút trên Actions (lần đầu build FFmpeg macOS; sau đó có cache).
- **Cần làm một lần:** Settings → Pages → Source: **GitHub Actions**.
- **Cần xem lại:** khi có chữ ký mã thì thêm secret vào workflow (`CSC_LINK`, `APPLE_ID`, …); khi lượt tải lớn thì cân nhắc B.

## Action Items

1. [x] Workflow build desktop + Release nháp + `SHA256SUMS.txt`.
2. [x] Workflow deploy Pages + `latest.json`.
3. [ ] Chọn hướng thiết kế trang tải (ba hướng ở `design-demos/site/`), rồi hoàn thiện `site/`.
4. [ ] Bật Pages (Source: GitHub Actions) và tạo tag đầu tiên.
