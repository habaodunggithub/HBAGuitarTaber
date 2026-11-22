# Gửi bản ghi lớn khi báo kết quả sai

**Ngày kiểm tra nguồn:** 2026-11-22 · **Ticket:** "Gửi bản ghi lớn khi báo kết quả sai"

## Tóm tắt và khuyến nghị

- GitHub Issues chặn ở **25 MB** cho `.zip`/`.wav`/`.mp3` và **10 MB** cho video (100 MB chỉ khi repo thuộc gói trả phí). Video điện thoại 1080p (~60–130 MB/phút) gần như không bao giờ lọt.
- Google Forms nhận file tới 10 GB nhưng **bắt người gửi đăng nhập Google**, và file nằm trong Drive của chủ form, ăn vào quota 15 GB (tài khoản mới từ 9/3/2026 chỉ có 5 GB, xác minh số điện thoại mới được thêm 10 GB).
- Nên để app **tự thu nhỏ trước khi đóng gói**: bỏ hình (giữ tiếng), cắt quanh đoạn sai, nén tiếng thành Opus/AAC 128 kb/s (~0,96 MB/phút). Gói `report.zip` (tiếng + tab + diagnostics) khi đó chứa được ~20 phút tiếng mà vẫn dưới 25 MB.
- **Khuyến nghị:** người có GitHub thì kéo `report.zip` vào issue form (phần tử `upload`). Người không có GitHub thì dùng Google Form *không có* câu hỏi tải file (để khỏi phải đăng nhập), dán link Google Drive/WeTransfer vào. Bản ghi gốc chỉ gửi khi maintainer xin thêm.

---

## 1. Giới hạn đính kèm của GitHub Issues

Nguồn: [Attaching files](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files) (kiểm tra 2026-11-22).

| Loại | Giới hạn |
|---|---|
| Ảnh và GIF | 10 MB |
| Video, repo của user/org dùng gói **free** | 10 MB |
| Video, repo của user/org dùng gói **trả phí** | 100 MB (người upload phải là thành viên org, outside collaborator hoặc tự dùng gói trả phí) |
| Mọi file khác (gồm `.zip`, `.wav`, `.mp3`, `.log`, `.json`…) | 25 MB |

Đuôi file được phép (cùng trang):
- Ảnh/video: `.png .gif .jpg .jpeg .svg .mp4 .mov .webm`. GitHub khuyên dùng H.264 vì phát lại phụ thuộc codec của trình duyệt.
- Âm thanh: chỉ có **`.mp3 .wav`**. Không có `.flac`, `.opus`, `.ogg`, `.m4a`, nên các định dạng này phải bỏ vào `.zip`.
- Nén: `.zip .gz .tgz`.
- Văn bản/dữ liệu: `.txt .md .csv .tsv .log .json .jsonc`, cùng nhiều đuôi code và tài liệu khác (`.pdf`, `.docx`, `.xml`, `.yaml`…).

Quyền riêng tư (cùng trang): file đính kèm trong **repo public** "can be accessed without authentication". Repo HBAGuitarTaber là public (`gh repo view` báo `"visibility":"PUBLIC"`, kiểm tra 2026-11-22), nên ai có URL cũng tải được bản ghi, kể cả video có mặt người chơi. App cần nói rõ điều này trước khi người dùng đính kèm.

**Issue form có phần tử `upload`** ([Syntax for GitHub's form schema](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema), kiểm tra 2026-11-22):
- Người gửi kéo-thả hoặc chọn file ngay trong form. Có `validations.accept` (danh sách đuôi) và `required` (chỉ có tác dụng ở repo public).
- Bảng giới hạn trên trang đó: Archives (`.zip .gz .tar.gz`) 25 MB, Text (`.json .log .txt .csv`…) 25 MB, Images 10 MB, Videos (`.mp4 .mov .webm`) 100 MB. Bảng này **không có dòng audio** và không tách free/trả phí như trang "Attaching files". Vì vậy cứ coi video là 10 MB, và cho audio vào trong `.zip`.
- Toàn bộ form schema đang ở "public preview and subject to change".
- `textarea` cũng nhận file đính kèm.

**Mở issue điền sẵn từ app** ([Creating an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue), kiểm tra 2026-11-22): URL query điền được `title`, `body`, `labels`, `template` và các trường text của issue form. URL quá dài trả về `414 URI Too Long`. Query **không đính kèm được file**, nên người dùng vẫn phải tự kéo `report.zip` vào.

## 2. Google Forms: câu hỏi tải file

Nguồn chính: [Google Docs Editors Help – choose a type of question](https://support.google.com/docs/answer/7322334?hl=en) (kiểm tra 2026-11-22):
- **Phải đăng nhập:** "To answer this question, responders need to sign in to a Google Account." Người không có tài khoản Google thì không dùng được câu hỏi này.
- **Nơi lưu:** "For the form owner, uploaded files are stored in a new folder on Google Drive."
- Chủ form chọn được loại file, số file tối đa và kích thước tối đa mỗi file. Trang này **không ghi con số cụ thể**.
- Không dùng được câu hỏi này khi form nằm trong shared drive, hoặc khi admin bật Data Loss Prevention.

Loại file: [Forms API – FileUploadQuestion](https://developers.google.com/workspace/forms/api/reference/rest/v1/forms) (kiểm tra 2026-11-22) liệt kê `ANY, DOCUMENT, PRESENTATION, SPREADSHEET, DRAWING, PDF, IMAGE, VIDEO, AUDIO`. **Không có nhóm "archive"**, nên muốn nhận `.zip` thì phải để "mọi loại file" (không giới hạn). API cũng nói "The API currently does not support creating file upload questions", tức là phải tạo câu hỏi bằng tay trong giao diện.

Tổng dung lượng mỗi form: [Google Workspace Updates, 07/2017](https://workspaceupdates.googleblog.com/2017/07/new-features-in-google-forms.html?hl=en) ghi "Total uploads to new forms will be capped at 1GB, with an option to increase that limit to 1TB." Đây là bài cũ nhưng là nguồn chính thức duy nhất tìm được. Khi chạm trần, form ngừng nhận câu trả lời ("This form can accept up to X of files", theo [hướng dẫn bên thứ ba](https://dmat.freshdesk.com/support/solutions/articles/43000624749-increase-google-forms-upload-limit)).

Con số trong dropdown (**chưa xác minh từ nguồn chính thức**, cần mở form kiểm lại): các nguồn bên thứ ba ([How-To Geek](https://www.howtogeek.com/817296/how-to-let-users-upload-files-and-photos-in-google-forms/), [Jotform](https://www.jotform.com/google-forms/how-to-add-upload-button-in-google-form/)) ghi mỗi file chọn được 1 MB / 10 MB / 100 MB / 1 GB / 10 GB, và số file chọn được 1 / 5 / 10.

**Quota của chủ form:** [Google Drive Help – storage](https://support.google.com/drive/answer/9312312?hl=en) (kiểm tra 2026-11-22):
- Mỗi tài khoản có tối đa 15 GB, dùng chung cho Gmail, Drive và Photos. Tài khoản tạo từ 9/3/2026 bắt đầu với 5 GB và được thêm 10 GB khi xác minh số điện thoại.
- File trong Drive tính vào quota. File trong thư mục chia sẻ tính vào quota của chủ sở hữu.
- Khi hết quota, hầu hết thao tác Drive bị chặn và không tạo được file mới trong Forms.
- Suy ra: mọi file người dùng upload qua form đều ăn vào 15 GB của maintainer. Với gói ~5–25 MB thì 15 GB chứa được khoảng 600–3.000 báo cáo. Với video gốc 300 MB thì chỉ khoảng 50.

## 3. Phương án không cần server: dán link chia sẻ

**Google Drive:** [Share files from Google Drive](https://support.google.com/drive/answer/2494822?hl=en) (kiểm tra 2026-11-22). Khi đặt "Anyone with the link" thì "Anyone on the internet who has the link can open the file without signing in to a Google Account."
- File nằm trong quota của **người gửi**, không phải của maintainer.
- Tài khoản trường/công ty có thể bị admin chặn chia sẻ ra ngoài.
- Người gửi vẫn cần tài khoản Google.

**WeTransfer (Free):**
- Hạn mức: "send up to 10 transfers (or 3 GB total) in any 30-day rolling window" ([Plan limits](https://wetransfer.com/help-center/subscriptions/plan-limits), cập nhật 23/10/2026).
- Cần tài khoản: "Starting November 2024, all users sending transfers via WeTransfer are required to have an account". Tài khoản Free được tạo tự động sau khi xác minh email bằng mã ([Why do I need an account](https://wetransfer.com/help-center/accounts/why-account-needed-to-send), cập nhật 29/5/2026).
- Thời hạn: transfer qua file request hết hạn "3 days on Starter or Free" ([Upload to a file request](https://wetransfer.com/help-center/how-to/upload-to-file-request), cập nhật 1/9/2026). Trang pricing không tải được (lỗi trang) nên chưa xác nhận được thời hạn của transfer thường ở gói Free trên trang chính thức. Các nguồn bên thứ ba ghi 3 ngày ([TransferNow](https://www.transfernow.net/en/wetransfer/limits)).
- Người nhận tải về không cần tài khoản ([Download a transfer](https://wetransfer.com/help-center/how-to/download-a-transfer)).
- Hệ quả: link chết sau ~3 ngày, maintainer phải tải về sớm. Không hợp với issue công khai cần lưu lâu.

**Giới hạn chung của phương án dán link:** người gửi vẫn cần *một* tài khoản nào đó (Google, hoặc email đã xác minh với WeTransfer). Link có thể hết hạn hoặc bị thu hồi. App không kiểm soát được nội dung tải lên.

## 4. App có nên thu nhỏ gói trước khi đóng gói?

**Có.** Các con số dưới đây cho thấy chỉ có tiếng đã nén mới đều đặn nằm dưới 25 MB.

### Kích thước ước tính mỗi phút

| Định dạng | Bitrate | MB/phút | Phút vừa 25 MB | Cách tính / nguồn |
|---|---|---|---|---|
| WAV 44,1 kHz 16-bit stereo | 1.411 kb/s | 10,6 | ~2,4 | 44.100 × 2 B × 2 kênh × 60 s (tính toán) |
| WAV 48 kHz 24-bit stereo (audio interface) | 2.304 kb/s | 17,3 | ~1,4 | tính toán |
| WAV 44,1 kHz 16-bit mono | 706 kb/s | 5,3 | ~4,7 | tính toán |
| FLAC 44,1/16 stereo | thay đổi | ~5–7,5 (ước tính) | ~3–5 | FLAC là lossless, "bit-for-bit identical" ([FLAC features](https://xiph.org/flac/features.html)). Xiph đã gỡ bảng so sánh tỉ lệ nén ([comparison](https://xiph.org/flac/comparison.html)); con số 50–70 % so với WAV là ước tính, **nên đo trên take thật**. |
| Opus 96 kb/s | 96 kb/s (VBR) | ~0,72 | ~34 | 96.000/8 × 60 (tính toán). Opus hỗ trợ 6–510 kb/s ([opus-codec.org](https://opus-codec.org/)); thử nghiệm HydrogenAudio ở 96 kb/s stereo cho Opus vượt LC-AAC, Vorbis và MP3 136 kb/s ([Opus comparison](https://opus-codec.org/comparison/)). |
| Opus 128 kb/s | 128 kb/s (VBR) | ~0,96 | ~26 | tính toán |
| AAC 128 kb/s (encoder `aac` có sẵn của FFmpeg) | 128 kb/s | ~0,96 | ~26 | mặc định 128 kb/s ([FFmpeg codecs – aac](https://ffmpeg.org/ffmpeg-codecs.html)) |
| Video điện thoại 1080p30, HEVC (iPhone) | — | ~60 | <0,5 | bên thứ ba: [VideoProc](https://videoproc.com/iphone-video-processing/iphone-video-size-per-minute.htm), [iMore](https://www.imore.com/how-shoot-trim-edit-and-share-4k-video-iphone-6s) (Apple không đăng con số này; [Apple](https://support.apple.com/en-in/116944) chỉ nói HEVC tốn ít chỗ hơn H.264) |
| Video điện thoại 1080p30, H.264 ("Most Compatible" / nhiều máy Android) | ~12–20 Mb/s | ~90–150 | <0,3 | iPhone ~130 MB/phút theo cùng nguồn bên thứ ba; dải Android là ước tính từ bitrate |
| Rãnh tiếng AAC trong video đó, tách bằng stream copy | ~96–256 kb/s | ~0,7–1,9 | ~13–35 | tính toán; không nén lại nên không mất chất lượng |

### Đề xuất cụ thể

1. **Bỏ hình, giữ tiếng (với video).** `ffmpeg -i take.mov -vn -c:a copy take.m4a` không mã hóa lại nên không mất chất lượng, và giảm ~50–100 lần. Chỉ giữ một vài khung hình (JPEG) nếu bug liên quan đến hiệu chỉnh video. Encoder MJPEG có sẵn trong FFmpeg của app (`apps/desktop/scripts/build-ffmpeg-macos.sh`).
2. **Cho người dùng cắt quanh đoạn sai.** Giữ đoạn sai cộng ±5–10 s ngữ cảnh, và ghi offset gốc vào diagnostics. Vì onset/tempo có thể phụ thuộc ngữ cảnh, app nên **chạy lại phân tích trên đoạn đã cắt** và báo cho người dùng biết lỗi có còn tái hiện không.
3. **Nén tiếng chỉ khi cần.** Thứ tự ưu tiên:
   - Giữ nguyên file gốc nếu cả gói ≤ 25 MB.
   - Nếu không, dùng FLAC (lossless).
   - Nếu vẫn quá, dùng Opus/AAC 128 kb/s.

   Nén lossy có thể làm đổi kết quả phân tích, nên diagnostics cần ghi rõ định dạng đã gửi. Lý tưởng là ghi luôn kết quả chạy lại trên bản đã nén.
4. **Lưu ý encoder trong bản build hiện tại:**
   - Bản FFmpeg macOS tự build với `--disable-autodetect` và không có `--enable-libopus` (`apps/desktop/scripts/build-ffmpeg-macos.sh`), nên **không có libopus**.
   - Encoder `opus` gốc của FFmpeg "only implements the CELT part" và "is usually worse and at best is equal to the libopus encoder"; libopus cần `--enable-libopus` ([FFmpeg codecs](https://ffmpeg.org/ffmpeg-codecs.html)).
   - Bản BtbN LGPL cho Windows/Linux có libopus: `scripts.d/50-libopus.sh` bật vô điều kiện (`ffbuild_enabled` trả `0`, thêm `--enable-libopus`) ([BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds/blob/master/scripts.d/50-libopus.sh)).
   - Cách đơn giản nhất cho mọi nền tảng là **AAC 128 kb/s (`.m4a`) bằng encoder `aac` có sẵn**, hoặc thêm libopus (giấy phép BSD) vào script build macOS.
5. **Đóng một file duy nhất `report.zip`** gồm tiếng, tab và diagnostics. `.zip` được GitHub nhận tới 25 MB và tránh được việc GitHub không nhận `.m4a`/`.opus`/`.flac` trực tiếp. App nên hiện kích thước gói và cảnh báo khi vượt 25 MB.

## Luồng khuyến nghị

**(a) Người dùng có tài khoản GitHub**
1. Trong app, bấm "Báo kết quả sai". Chọn đoạn sai (mặc định là cả take), rồi app chạy lại phân tích trên đoạn đó.
2. App tạo `report.zip`: tiếng đã bỏ hình hoặc cắt (giữ nguyên nếu đủ nhỏ, không thì FLAC, rồi AAC/Opus 128 kb/s), tab, diagnostics. Mục tiêu ≤ 25 MB. Với tiếng 128 kb/s, mức này chứa được ~20 phút sau khi trừ chỗ cho diagnostics.
3. App mở URL issue điền sẵn (`template=` + các trường text) và mở thư mục chứa `report.zip`. Người dùng kéo file vào phần tử `upload` của issue form.
4. Cảnh báo trước khi gửi: repo public nên ai có link cũng tải được file.

**(b) Người dùng không có tài khoản GitHub**
1. Bước 1–2 giống (a).
2. App mở một Google Form **không có câu hỏi tải file**, nên không bắt đăng nhập. Form có các trường mô tả lỗi, phiên bản app (điền sẵn qua URL) và **một trường dán link**.
3. Người dùng tải `report.zip` lên Google Drive của họ (đặt "Anyone with the link"), hoặc gửi qua WeTransfer Free (xác minh email, link sống ~3 ngày), rồi dán link vào form. Maintainer tải về sớm và có thể chuyển nội dung sang issue công khai nếu người dùng đồng ý.
4. Tùy chọn: thêm một form thứ hai *có* câu hỏi tải file (giới hạn 25–100 MB mỗi file, loại "mọi file") cho người đã đăng nhập Google. Đổi lại, maintainer phải theo dõi quota 15 GB (hoặc 5 GB) và trần 1 GB mặc định của form.

Bản ghi gốc kích thước đầy đủ (video hàng trăm MB) không đi theo luồng mặc định. Maintainer chỉ xin khi thật cần, qua link Drive/WeTransfer.
