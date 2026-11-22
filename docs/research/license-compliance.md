# Tuân thủ giấy phép của mọi thứ đi kèm

Ngày kiểm tra: 2026-11-22, trên commit `36ebaf1`. Phạm vi: những gì nằm trong bộ cài (Windows NSIS, macOS DMG,
Linux AppImage/deb) và những gì app hoặc engine tải về ở lần chạy đầu, đối chiếu với `THIRD_PARTY_LICENSES.md`.
Đây không phải tư vấn pháp lý: mỗi nhận định đều dẫn về văn bản giấy phép gốc hoặc trang của bên giữ quyền.

## Kết luận

- **Không có xung đột giấy phép về nội dung.** Không có thành phần GPL hay AGPL nào được phân phối. Cả hai bản FFmpeg
  đều không có `--enable-gpl` hay `--enable-nonfree`. Không model nào đi kèm được train trên dữ liệu NC hay ND:
  bộ phân loại dây chỉ train trên GuitarSet (CC BY 4.0), còn IDMT-SMT-Guitar (CC BY-NC-ND 4.0) chỉ dùng để đo.
  `LICENSE` §6 giữ nguyên quyền mà license của bên thứ ba cho người dùng.
- **Có vi phạm điều kiện kèm theo khi phân phối**, tức chỗ thiếu thông báo và thiếu mã nguồn. Với MIT, BSD,
  Apache, OFL, LGPL và MPL, việc kèm notice hay mã nguồn chính là điều kiện để được phân phối lại, nên thiếu
  chúng là vi phạm chứ không chỉ là "thiếu lịch sự". Tất cả đều sửa được mà không phải thay thành phần nào:
  1. FFmpeg: chưa cung cấp mã nguồn tương ứng "cùng chỗ" với bộ cài. Bản Windows/Linux (BtbN) thực ra là
     **LGPL-3.0-or-later**, liên kết tĩnh khoảng 50 thư viện ngoài, nhưng không kèm notice của chúng, không kèm
     văn bản GPLv3, và `SOURCE.txt` vừa ghi sai license vừa trỏ tới một link sẽ bị thay.
  2. `uv` được ship mà không có file license.
  3. SPA và trang setup: thiếu toàn văn MIT/BSD của các thư viện JS, thiếu chỗ lấy mã nguồn alphaTab (MPL-2.0
     §3.2(a)), thiếu văn bản OFL của Six Caps, Caveat, IBM Plex Mono, và thiếu toàn văn Apache-2.0 cho soundfont
     SONiVOX.
- **Ghi công còn thiếu hoặc sai** trong `THIRD_PARTY_LICENSES.md`: GuitarSet (thiếu link dữ liệu và link
  license, lại tự mâu thuẫn), Beat This! vẫn bị ghi là "planned", thiếu MediaPipe, OpenCV, lameenc, NVIDIA CUDA,
  và đang dẫn tới một ADR-008 không tồn tại.

## 1. Thực sự đi kèm những gì

### 1.1 Trong bộ cài (chúng ta phân phối)

| Thành phần | Vị trí trong bộ cài | Đọc từ |
|---|---|---|
| Electron 45.2.3 (Chromium, Node.js, `libffmpeg` của Chromium), `LICENSE.electron.txt`, `LICENSES.chromium.html` | thư mục app (Win/Linux); `Contents/Resources` (macOS) | `apps/desktop/package.json`; `app-builder-lib@26.18.0/out/electron/ElectronFramework.js` (`retainElectronLicenseFiles`) |
| Mã shell `dist/**`, trang setup, 4 file `.woff2` (Six Caps, Caveat, IBM Plex Mono) | `app.asar` | `apps/desktop/electron-builder.yml` (`files`), `apps/desktop/scripts/copy-static.mjs` |
| SPA đã build: bundle JS (React, react-router, TanStack Query, zustand, wavesurfer.js, alphaTab), khoảng 50 file font @fontsource, `font/` (Bravura và OFL của nó), `soundfont/` (SONiVOX `.sf2`/`.sf3`) | `resources/web` | `apps/desktop/scripts/stage.mjs`; `apps/web/public/` (Bravura và SONiVOX được commit vào repo); `apps/web/src/styles.css` |
| 3 wheel của dự án. Wheel `taber-ml` chứa `basic_pitch_nmp.onnx` (kèm `basic_pitch_LICENSE.txt`, `basic_pitch_NOTICE.txt`), `string_cnn.pt`, `string_cnn_large.pt` | `resources/python/wheels` | `stage.mjs`; `unzip -l` wheel trong `apps/desktop/stage` |
| `requirements-{gpu,cpu,lite}.txt` (chỉ có tên, phiên bản, hash) | `resources/python` | `stage.mjs` |
| `uv` 0.12.6, chỉ có file nhị phân | `resources/bin` | `stage.mjs` (mục `uv`) |
| FFmpeg `ffmpeg`/`ffprobe`, `LICENSE.txt`, `SOURCE.txt`. Win: kèm các `.dll`; Linux: kèm `lib/*.so*` | `resources/ffmpeg` | Win/Linux: `apps/desktop/scripts/fetch-ffmpeg.mjs` (BtbN `lgpl-shared`, release `latest`, nhánh `n8.1`); macOS: `apps/desktop/scripts/build-ffmpeg-macos.sh` (8.1.3 từ tarball) |
| `LICENSE.txt`, `THIRD_PARTY_LICENSES.md` | `resources/`; NSIS cũng hiện `LICENSE.txt` trước khi cài | `electron-builder.yml` (`extraResources`, `nsis.license`) |

GitHub Release chỉ chứa `.exe/.dmg/.AppImage/.deb` (`.github/workflows/desktop.yml`, job `release`). Không có
asset mã nguồn nào của bên thứ ba.

### 1.2 Tải về trên máy người dùng (bộ cài không chứa)

| Thành phần | Tải từ | Đọc từ |
|---|---|---|
| CPython 3.12 (python-build-standalone) | GitHub, do `uv` tải | `apps/desktop/src/runtime.ts` |
| Các gói Python trong `uv.lock` (bản gpu có thêm `nvidia-*`, `triton`, `cuda-*`) | PyPI; torch lấy từ `download.pytorch.org/whl/cu132` hoặc `/cpu` | `apps/desktop/runtime.config.json`, `stage/python/requirements-gpu.txt` |
| Trọng số Demucs `htdemucs_6s` | `https://dl.fbaipublicfiles.com/demucs/` | `taber_ml/audio/separation.py`; `demucs/pretrained.py` (`ROOT_URL`) |
| Checkpoint Beat This! `final0` | `https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp` | `taber_ml/audio/beats.py`; `beat_this/inference.py` (`CHECKPOINT_URL`) |
| MediaPipe `hand_landmarker.task` | `storage.googleapis.com/mediapipe-models/...` | `taber_ml/video/hands.py` (`MODEL_URL`) |
| Trọng số PESTO (`mir-1k_g7.ckpt`), trọng số torchcrepe | nằm sẵn trong wheel trên PyPI | `pesto/weights/` trong repo upstream |

Với những thứ trong bảng 1.2, chính PyPI, PyTorch, Meta, JKU và Google gửi bản sao thẳng cho người dùng; bộ cài
chỉ chứa tên và hash. Vì vậy nghĩa vụ "khi phân phối" (kèm license, cung cấp mã nguồn) thuộc về bên đăng gói,
không thuộc về chúng ta. Đó là cách hiểu thông thường, không phải kết luận pháp lý. Điều khoản *sử dụng* thì vẫn
ràng buộc người dùng (ví dụ EULA của NVIDIA). Có một điểm chưa đạt: màn hình setup chỉ nói "downloaded once,
from PyPI and PyTorch" (`apps/desktop/static/setup.html`), trong khi model còn được tải từ ba host khác.

## 2. FFmpeg

### 2.1 Bản Windows/Linux (BtbN `lgpl-shared`)

Để đọc dòng configure, tôi tải `ffmpeg-n8.1-latest-linux64-lgpl-shared-8.1.tar.xz` (release `latest`, 2026-11-22)
và chạy `strings` trên `libavutil.so.60`, không chạy file nhị phân:

- Phiên bản: `n8.1.3-39-g660b5aa7db-20261121`. Đây là một snapshot git của nhánh `release/8.1`, không phải
  tarball 8.1.3.
- Cờ license: `--enable-version3`, **không có** `--enable-gpl` và `--enable-nonfree`. x264, x265, xvid, vidstab,
  rubberband, frei0r, zvbi, fdk-aac đều bị tắt. Biến thể lgpl của BtbN đặt `FF_CONFIGURE="--enable-version3"`
  và `LICENSE_FILE="COPYING.LGPLv3"` (https://github.com/BtbN/FFmpeg-Builds/blob/master/variants/defaults-lgpl.sh).
  `LICENSE.txt` trong archive là LGPLv3 (165 dòng) và không có văn bản GPLv3.
- Thư viện ngoài được liên kết tĩnh (`--pkg-config-flags=--static`; `readelf -d libavcodec.so` chỉ cần
  libc/libm): openssl (đọc được chuỗi "OpenSSL 3.6.5"), libmp3lame (đọc được "LAME4.1b"), libvpx, dav1d, aom,
  rav1e, svtav1, opus, vorbis, theora, webp, libjxl, openjpeg, openh264, opencore-amr, twolame, soxr, libass,
  harfbuzz, freetype, fribidi, fontconfig, libxml2, librsvg, libbluray, libssh, libzmq, srt, librist, gmp, lzma,
  zimg, libplacebo, shaderc, vulkan, openal, libopenmpt, gme, kvazaar, vvenc, uavs3d, oapv, lcevc-dec,
  aribb24/aribcaption, chromaprint, snappy, sdl2, pulse, xcb… tổng cộng khoảng 50 `--enable-lib*`.

So với nghĩa vụ:

- **Không phải 2.1.** Có `--enable-version3` nên bản build là LGPL-3.0-or-later. LGPLv3 "incorporates the
  terms and conditions of version 3 of the GNU General Public License", nên khi phân phối thư viện ở dạng object
  code phải tuân theo GPLv3 §4 (kèm bản license, ở đây là cả GPLv3 lẫn LGPLv3) và §6 (mã nguồn). Hiện tại
  `SOURCE.txt` ghi "LGPL-2.1-or-later", và `THIRD_PARTY_LICENSES.md` ghi "LGPL-2.1-or-later" cho cả ba OS: **sai**.
- **Mã nguồn tương ứng.** Cách dùng được khi phân phối qua mạng là GPLv3 §6(d): "offer equivalent access to the
  Corresponding Source in the same way through the same place". Nếu để mã nguồn trên server của bên thứ ba thì
  phải có "clear directions next to the object code saying where to find the Corresponding Source" và "you
  remain obligated to ensure that it is available for as long as needed". "Corresponding Source" ở đây gồm cả
  "the source code for shared libraries … that the work is specifically designed to require" và "scripts to
  control those activities" (GPLv3 §1, §6). `SOURCE.txt` chỉ trỏ tới `ffmpeg.org/download.html`, repo BtbN và
  URL `releases/download/latest/...`. URL này bị thay hằng ngày (asset tên `...-n8.1-latest-...`), nên từ một bộ
  cài không thể xác định được mã nguồn đúng commit `660b5aa7db`, và cũng không đảm bảo được mã nguồn còn tồn tại:
  **không đạt**.
- **Lib LGPL bên trong** (LAME, twolame, soxr, fribidi, libbluray, libssh, librsvg, openal, gmp, aribb24…):
  FFmpeg nhắc "Go through all the items again for any LGPL external library you compiled into FFmpeg (for
  example LAME)" (https://ffmpeg.org/legal.html). Mã nguồn của chúng cũng phải được cung cấp: **không đạt**.
- **Lib BSD/MIT/Apache bên trong:** ví dụ libvpx (BSD-3) "Redistributions in binary form must reproduce the above
  copyright notice … in the documentation" (https://github.com/webmproject/libvpx/blob/main/LICENSE); OpenSSL 3
  là Apache-2.0, mà §4(a) đòi kèm bản license. Archive BtbN không có notice nào cho các lib này, `fetch-ffmpeg.mjs`
  cũng không thêm: **không đạt**.
- Ngoài phạm vi bản quyền: openh264 được BtbN build từ mã nguồn, nên không được hưởng giấy phép bằng sáng chế
  H.264 miễn phí mà Cisco chỉ cấp cho bản nhị phân do chính Cisco phát hành. App không cần encoder H.264.

`stage.mjs` chặn `--enable-gpl|--enable-nonfree` nhưng không bắt được `--enable-version3`. Chính vì vậy bản
LGPLv3 lọt qua mà nhãn vẫn ghi 2.1.

**Đề xuất:** đừng vá BtbN, hãy tự build FFmpeg trên Windows và Linux theo đúng cách `build-ffmpeg-macos.sh` đang
làm: tarball release, `--disable-autodetect`, chỉ dùng decoder và encoder AAC/MJPEG của chính FFmpeg. Khi đó chỉ
còn một license (LGPL-2.1-or-later), một tarball mã nguồn cần đính kèm, và không còn notice nào của lib ngoài. Bản
build cũng nhỏ hơn nhiều: thư mục `lib/` của BtbN Linux nặng 173 MB.

### 2.2 Bản macOS (tự build)

`build-ffmpeg-macos.sh`: `--disable-gpl --disable-nonfree --disable-network --disable-autodetect --enable-zlib
--enable-audiotoolbox --enable-videotoolbox --enable-static --disable-shared`. Không có `--enable-version3`, nên
bản build là LGPL-2.1-or-later. zlib, AudioToolbox và VideoToolbox là thư viện hệ thống của macOS. Script kèm
`COPYING.LGPLv2.1`, URL tarball, SHA-256 và dòng configure vào `SOURCE.txt`, như vậy là đạt các mục "Explain how
you compiled FFmpeg" và không có GPL. Liên kết tĩnh ở đây không thành vấn đề: `ffmpeg`/`ffprobe` cũng là mã
FFmpeg, và app chỉ chạy chúng như tiến trình riêng chứ không link vào.

Thiếu: LGPL-2.1 §4 cho phép phân phối object code nếu "accompany it with the complete corresponding
machine-readable source code", hoặc "offering equivalent access to copy the source code from the same place"
(https://www.gnu.org/licenses/old-licenses/lgpl-2.1.txt). Điều khoản này không có lựa chọn "written offer" cho
chính thư viện. FFmpeg cũng ghi "Host the FFmpeg source code on the same webserver as the binary you are
distributing" (https://ffmpeg.org/legal.html). Mã nguồn hiện chỉ có trên ffmpeg.org, không có trên GitHub Release:
**không đạt**. Ngoài ra nên kèm `LICENSE.md` của FFmpeg, vì một số file trong cây mã nguồn dùng license khác.

### 2.3 Các mục còn lại của checklist FFmpeg

https://ffmpeg.org/legal.html là checklist cho chương trình *link* với FFmpeg. App chỉ gọi file thực thi, nên
những mục dưới đây là khuyến nghị, không phải điều kiện của license:

- "This software uses libraries from the FFmpeg project under the LGPLv2.1" trong About box: chưa có.
  `app.setAboutPanelOptions` trong `apps/desktop/src/main.ts` không có credits, và menu không có mục nào về giấy phép.
- Trên trang có link tải: `site/index.html` chỉ có link "Third-party licenses" ở footer.
- Trong EULA: `LICENSE` §6 có nêu FFmpeg và "Nothing in this license limits a right those licenses give you". Như
  vậy là đạt về mặt không thêm hạn chế (GPLv3 §10, LGPL-2.1 §10). `LICENSE` cũng không cấm reverse engineering.

### 2.4 FFmpeg bên trong Electron

Electron có kèm `libffmpeg.so` / `ffmpeg.dll` của Chromium (LGPL), và `LICENSES.chromium.html` đã có mục "ffmpeg"
(đã kiểm trong `node_modules/electron/dist`). Chúng ta chỉ phân phối lại nguyên bản Electron, mã nguồn công khai ở
Electron và Chromium. Rủi ro thấp; muốn chặt chẽ thì thêm link mã nguồn Electron v45.2.3 vào lời cung cấp mã nguồn
ở mục 2.1.

## 3. Electron / Chromium

MIT cho Electron; Chromium là BSD-3-Clause cộng license của từng thành phần, gom trong `LICENSES.chromium.html`
(498 mục, có Node.js, ffmpeg, OpenH264, libvpx, dav1d). electron-builder 26.18 giữ cả hai file: "both licenses
require them to be retained in distributables", trên macOS thì chuyển vào `Contents/Resources`
(`retainElectronLicenseFiles`; https://github.com/electron-userland/electron-builder/issues/9407). **Đạt.**
`THIRD_PARTY_LICENSES.md` cũng ghi đúng.

## 4. uv

uv có license "either of Apache License, Version 2.0 … or MIT license … at your option"
(https://github.com/astral-sh/uv). Theo cả hai license, bản phân phối phải kèm văn bản license: MIT là "this
permission notice shall be included", Apache là §4(a). `stage.mjs` chỉ chép file nhị phân `uv`: **không đạt**.
Bản nhị phân uv còn liên kết tĩnh hàng trăm crate Rust (MIT/Apache/BSD…). Repo uv chỉ có `LICENSE-APACHE` và
`LICENSE-MIT`, không có file notice cho bên thứ ba, nên đây là khoảng trống mà chính upstream cũng để ngỏ; tối thiểu
cần kèm hai file license của đúng tag 0.12.6.

## 5. SPA và trang setup

| Thành phần | License | Trạng thái |
|---|---|---|
| React, react-dom, scheduler | MIT | `index-*.js` còn header `@license React … licensed under the MIT license found in the LICENSE file in the root directory of this source tree`, nhưng file LICENSE đó không được ship. Thiếu toàn văn MIT: **không đạt** |
| react-router-dom, @tanstack/react-query, zustand | MIT | react-router chỉ còn `@license MIT`, hai cái còn lại không có gì. **Không đạt** |
| wavesurfer.js 7.12 | BSD-3-Clause, © 2012-2023 katspaugh and contributors | `wavesurfer.esm-*.js` không có header. BSD-3 bắt buộc tái hiện notice trong tài liệu: **không đạt** |
| alphaTab 1.9.0 | MPL-2.0; có kèm TinySoundFont, SFZero (MIT) | Header MPL và danh sách "Integrated Libraries" còn trong `alphaTab.core-*.js` (§3.4: đạt). MPL §3.2(a): "You must inform recipients of the Executable Form how they can obtain a copy of such Source Code Form", mà không chỗ nào ghi repo hay tag: **không đạt** |
| Dòng "♪ alphaTab.net" của alphaTab | header alphaTab 1.9.0: "must stay visible in the rendered output … requires permission" (https://alphatab.net/docs/attribution) | Code không ẩn nó (`TabView.tsx` chỉ tắt `ScoreTitle`; không có CSS nào nhắm vào `.at-surface`). Chưa kiểm bằng mắt với bài trên 10 ô nhịp: **chưa rõ**, chỉ cần kiểm, đừng tắt |
| Bravura | OFL 1.1, © Steinberg, RFN "Bravura" | `Bravura-OFL.txt` và `FONTLOG` nằm cạnh font, font không bị sửa: **đạt** |
| Six Caps, Caveat, IBM Plex Mono (SPA: `resources/web/assets`; trang setup: `app.asar/dist/static/fonts`) | OFL 1.1 | Điều kiện 2 của OFL: "each copy contains the above copyright notice and this license", hoặc đặt trong metadata "as long as those fields can be easily viewed by the user". Bảng `name` của các file `.woff` @fontsource có copyright (nameID 0) nhưng không có văn bản license (nameID 13 trống); Six Caps không có cả URL license (nameID 14). Bản build không kèm file OFL nào, trong khi `site/fonts/OFL-*.txt` thì có: **không đạt** |
| SONiVOX `sonivox.sf2`/`.sf3` (bản alphaTab kèm theo) | Apache-2.0, © Sonic Network | File `soundfont/LICENSE` chỉ là đoạn notice ngắn có link, chưa phải "a copy of this License" (§4(a)): **không đạt**. README còn ghi nguồn gốc không rõ ràng ("Using a Creative Sound Blaster GM bank … wt210k_G.sf2"). App đặt `playerMode: Disabled` (`TabView.tsx`), nên soundfont bị ship (2.3 MB) mà không được dùng |

Rủi ro thấp, không mở ticket: Six Caps có "Reserved Font Names 'Six Caps'" (`@fontsource/six-caps/LICENSE`), mà
OFL-FAQ 2.6 coi bản font web đã tối ưu là "Modified Versions and so must follow OFL requirements like appropriate
renaming". Bản subset của @fontsource lấy từ Google Fonts, vốn cũng chỉ phát bản subset; trang tải `site/` cũng ở
tình trạng tương tự.

## 6. Trọng số model và dữ liệu train

| Model | Phân phối bởi | License của trọng số | Dữ liệu train và ràng buộc | Kết luận |
|---|---|---|---|---|
| Basic Pitch `nmp.onnx` | **chúng ta** (vendored trong wheel) | Apache-2.0, © 2022 Spotify (https://github.com/spotify/basic-pitch) | GuitarSet, MAESTRO, Slakh, iKala, MedleyDB (Table 1, https://arxiv.org/abs/2203.09893). MAESTRO là "CC BY-NC-SA 4.0" (https://magenta.tensorflow.org/datasets/maestro) | Toàn văn LICENSE và NOTICE nằm cạnh model trong wheel: **đạt**. Spotify phát hành dưới Apache, nên rủi ro NC từ dữ liệu train nằm ở phía upstream; app đang phi thương mại |
| Bộ phân loại dây `string_cnn*.pt` | **chúng ta** | của dự án (`LICENSE` §1 "models and weights trained for it") | Chỉ GuitarSet người chơi 00-03 (`taber_ml/training.py`: "Player 05 and IDMT-SMT-Guitar are never touched here"); GuitarSet là "Creative Commons Attribution 4.0 International" (https://zenodo.org/records/3371780) | Xem bên dưới |
| Demucs `htdemucs_6s` | Meta (`dl.fbaipublicfiles.com`) | README: "Demucs is released under the MIT license"; không ghi riêng cho trọng số. Repo đã archive từ 2025-01-01 (https://github.com/facebookresearch/demucs) | "MUSDB HQ dataset + an extra training dataset of 800 songs" | Không phải chúng ta phân phối, app phi thương mại: **đạt**; ghi chú rủi ro |
| Beat This! `final0` | JKU (`cloud.cp.jku.at`) | "The code and the published model weights are released under the MIT license" (https://github.com/CPJKU/beat_this) | "trained on all data except the GTZAN dataset", trong đó "some of the training files are fully copyrighted or under limited Creative Commons licenses"; 16 bộ (asap, ballroom, beatles, harmonix, rwc, …: https://github.com/CPJKU/beat_this_annotations) | **Đạt**; ghi chú rủi ro |
| PESTO `mir-1k_g7` | PyPI (`pesto-pitch`) | LGPL-3.0 (classifier trên PyPI; https://github.com/SonyCSLParis/pesto) | "only a single model trained on MIR-1K is provided"; MIR-1K không có license công khai, bản Zenodo bị hạn chế và ghi "contact the author" (https://zenodo.org/records/3532216) | **Đạt** cho dùng phi thương mại; điều khoản dữ liệu chưa rõ |
| MediaPipe `hand_landmarker.task` | Google (`storage.googleapis.com`) | Apache-2.0, "Stated as Apache License, Version 2.0 in the bundled upstream Google model-card PDF" (https://huggingface.co/litert-community/MediaPipe-HandLandmarker-Full) | Model card loại trừ "surveillance or identity recognition" | **Đạt**; chưa có trong inventory |
| torchcrepe (full/tiny) | PyPI | MIT | | **Đạt** |

**GuitarSet và trọng số của chúng ta.** Nếu trọng số được coi là "Adapted Material", CC BY 4.0 §3(a)(1) đòi:
tên tác giả, copyright notice, "a notice that refers to this Public License", notice về disclaimer, "a URI or
hyperlink to the Licensed Material", ghi rõ có sửa đổi hay không, và "include the text of, or the URI or hyperlink
to, this Public License". §3(a)(4) thêm: license của người chuyển thể không được ngăn người nhận tuân thủ CC BY
(https://creativecommons.org/licenses/by/4.0/legalcode). Câu hỏi trọng số có phải là "Adapted Material" hay không
vẫn còn bỏ ngỏ. Dù vậy ghi công đầy đủ là việc rẻ, và `LICENSE` §6 không chặn người nhận tuân thủ. Hiện tại
`THIRD_PARTY_LICENSES.md` có tên tác giả và bài ISMIR 2018 nhưng thiếu link dữ liệu (DOI 10.5281/zenodo.3371780),
thiếu link license, và thiếu câu "train từ dữ liệu, không phân phối lại dữ liệu". Mục "Datasets" lại ghi GuitarSet
"used only for evaluation … not for training", trái với dòng trọng số: **thiếu ghi công, tự mâu thuẫn**.

**IDMT-SMT-Guitar V2.** License là "Creative Commons Attribution Non Commercial No Derivatives 4.0 International"
(https://zenodo.org/records/7544110). Code chỉ dùng nó trong `ml/eval/*_study.py` (`string_study.py`: "test. Never
trained or tuned on"). Tham số trong `ml/eval/tuned.json` và `audio/segment.py` được tune trên GuitarSet 00-03.
`docs/ARCHITECTURE.md` cũng nêu rõ quy tắc này. Không có Adapted Material nào được chia sẻ, và việc dùng là phi
thương mại: **đạt**. Cần giữ quy tắc: không train, không tune, không chọn checkpoint trên IDMT.

## 7. Gói Python tải ở lần chạy đầu

Tôi đọc metadata PyPI của những phiên bản đang khoá trong lock. Có những mục chưa được ghi trong
`THIRD_PARTY_LICENSES.md`: `mediapipe` 1.2.2 (Apache-2.0), `opencv-contrib-python` / `opencv-python-headless`
5.0.0.93 (Apache-2.0; wheel có kèm FFmpeg riêng), `lameenc` 1.9.0 (LGPL-3.0-or-later, dependency của demucs),
`sounddevice` (MIT), `openunmix` (MIT), `torchaudio`, `huggingface-hub` (Apache-2.0), `certifi` (MPL-2.0), `tqdm`
(MPL-2.0 AND MIT), `llvmlite` (BSD-2 AND Apache-2.0 WITH LLVM-exception), `alembic` (MIT), `structlog` (MIT OR
Apache-2.0), `python-multipart` (Apache-2.0), cùng các gói `nvidia-*` / `cuda-*` / `triton` của bản GPU. Metadata
PyPI của `nvidia-cudnn-cu13` 9.26 và `nvidia-cublas` 13.4 không ghi license. Đây là thư viện độc quyền theo EULA
của NVIDIA (https://docs.nvidia.com/cuda/eula/), và tôi chưa đọc chi tiết EULA. Không gói nào là GPL hay AGPL.
Chúng ta không phân phối các gói này, nên ở đây chỉ cần inventory cho đúng và báo cho người dùng.

## 8. Chỗ sai trong `THIRD_PARTY_LICENSES.md`

1. FFmpeg ghi "LGPL-2.1-or-later" cho cả ba OS; Win/Linux thực ra là LGPL-3.0-or-later (mục 2.1).
2. Mục "Datasets" ghi GuitarSet "not for training", mâu thuẫn với dòng trọng số string classifier.
3. Bảng "Evaluation data (not shipped)" đang chứa nhầm các dòng thư viện (librosa, mido, numpy, pydantic, uvicorn…).
4. "Not installed (planned): Beat This!" là sai, vì beat-this 1.1.0 đã cài và có dòng riêng.
5. Thiếu: MediaPipe và `hand_landmarker.task`, OpenCV, lameenc, NVIDIA CUDA, certifi/tqdm (MPL-2.0),
   alembic/structlog/python-multipart, SONiVOX (Apache-2.0) và Bravura (OFL) thành dòng riêng, link mã nguồn
   alphaTab, ghi chú về dữ liệu train của Demucs, PESTO và Basic Pitch.
6. Dẫn chiếu "ADR-008", nhưng `docs/adr/` chỉ có ADR-011 và ADR-012.

## 9. Nếu sau này cấp phép thương mại (`LICENSE` §7)

Mọi thứ hiện đang ổn vì dự án phi thương mại. Nếu tác giả cấp quyền thương mại cho ai đó thì phải rà lại: dữ liệu
train của Beat This! (có bộ "fully copyrighted"), Demucs (MUSDB và 800 bài nội bộ), PESTO (MIR-1K), Basic Pitch
(MAESTRO NC-SA, MedleyDB, iKala), EULA NVIDIA, và bằng sáng chế codec (H.264/AAC trong FFmpeg và Electron).
IDMT không bị ảnh hưởng nếu vẫn chỉ dùng để đo trong nội bộ.

## Nguồn chính

- FFmpeg: https://ffmpeg.org/legal.html; BtbN: https://github.com/BtbN/FFmpeg-Builds (README, `variants/defaults-lgpl.sh`)
- LGPL-2.1 §4: https://www.gnu.org/licenses/old-licenses/lgpl-2.1.txt; LGPLv3: https://www.gnu.org/licenses/lgpl-3.0.txt;
  GPLv3 §1, §4, §6: https://www.gnu.org/licenses/gpl-3.0.txt
- libvpx (ví dụ BSD-3): https://github.com/webmproject/libvpx/blob/main/LICENSE
- electron-builder 26.18.0 `app-builder-lib/out/electron/ElectronFramework.js`; https://github.com/electron-userland/electron-builder/issues/9407
- uv: https://github.com/astral-sh/uv
- MPL-2.0 §3.2: https://www.mozilla.org/MPL/2.0/; alphaTab: https://alphatab.net/docs/attribution
- OFL 1.1 và OFL-FAQ: https://openfontlicense.org/ (bản copy trong `apps/web/public/font/Bravura-OFL*.txt`)
- Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0; CC BY 4.0: https://creativecommons.org/licenses/by/4.0/legalcode
- GuitarSet: https://zenodo.org/records/3371780; IDMT-SMT-Guitar: https://zenodo.org/records/7544110; MIR-1K: https://zenodo.org/records/3532216;
  MAESTRO: https://magenta.tensorflow.org/datasets/maestro
- Beat This!: https://github.com/CPJKU/beat_this, https://github.com/CPJKU/beat_this_annotations
- Demucs: https://github.com/facebookresearch/demucs; PESTO: https://github.com/SonyCSLParis/pesto;
  Basic Pitch: https://github.com/spotify/basic-pitch, https://arxiv.org/abs/2203.09893
- MediaPipe Hand Landmarker: https://huggingface.co/litert-community/MediaPipe-HandLandmarker-Full
- Metadata PyPI: `https://pypi.org/pypi/<gói>/<phiên bản>/json`

## Ticket sửa

Nhãn: **[Vi phạm]** là thiếu điều kiện bắt buộc của license; **[Ghi công]** là thiếu hoặc sai ghi công, hoặc
inventory sai; **[Khuyến nghị]** là không bắt buộc.

1. **[Vi phạm] Tự build FFmpeg LGPL-2.1 tối giản cho Windows và Linux, bỏ BtbN.** Viết script build từ
   `ffmpeg-<sourceVersion>.tar.xz` với cùng bộ cờ như macOS (`--disable-gpl --disable-nonfree --disable-autodetect
   --disable-network`, chỉ dùng decoder và encoder AAC/MJPEG của chính FFmpeg). Chạy trong CI có cache, rồi bỏ
   `btbnRelease`/`btbnBranch`. Kết quả: hết LGPLv3, hết khoảng 50 lib ngoài cần notice và mã nguồn, hết openh264.
   File: `apps/desktop/scripts/fetch-ffmpeg.mjs` (thay bằng `build-ffmpeg.sh` dùng chung, hoặc thêm script cho
   Win/Linux), `apps/desktop/runtime.config.json`, `.github/workflows/desktop.yml`, `apps/desktop/scripts/stage.mjs`.
2. **[Vi phạm] Đính mã nguồn FFmpeg vào mỗi GitHub Release.** Job `release` đính thêm `ffmpeg-<ver>.tar.xz`, một
   file `ffmpeg-build.txt` (dòng configure của từng OS) và `LICENSE.md` của FFmpeg. `SOURCE.txt` ghi tên asset đó
   ("source: the ffmpeg-<ver>.tar.xz asset of this release"). Đây là điều kiện "same place" của LGPL-2.1 §4 và
   checklist FFmpeg. File: `.github/workflows/desktop.yml`, `apps/desktop/scripts/build-ffmpeg-macos.sh` (ghi
   `SOURCE.txt`, chép `LICENSE.md`).
3. **[Vi phạm] Biện pháp tạm thời nếu chưa làm được #1: sửa nhãn và ghim bản BtbN.** Ghim một tag autobuild có
   ngày thay cho `latest`, rồi ghi commit FFmpeg (đọc từ `-version`) vào `SOURCE.txt`. Đổi chữ "LGPL-2.1-or-later"
   thành "LGPL-3.0-or-later" và kèm `COPYING.GPLv3`. Lưu bản sao mã nguồn đúng commit cùng script BtbN, và gom
   notice của các lib ngoài. Thêm vào `stage.mjs` một kiểm tra: nếu có `--enable-version3` thì bắt buộc phải có
   GPLv3. File: `apps/desktop/scripts/fetch-ffmpeg.mjs`, `apps/desktop/runtime.config.json`, `apps/desktop/scripts/stage.mjs`.
   (Bỏ ticket này nếu đã làm #1.)
4. **[Vi phạm] Kèm file license của uv.** Trong `stage.mjs`, tải `LICENSE-MIT` và `LICENSE-APACHE` của đúng tag uv
   (lấy từ `uv --version`) vào `stage/bin/uv-LICENSE-MIT.txt` và `uv-LICENSE-APACHE.txt`, và fail nếu thiếu. File:
   `apps/desktop/scripts/stage.mjs`.
5. **[Vi phạm] Sinh file notice cho bundle JS của SPA.** Thêm `rollup-plugin-license` (hoặc một script nhỏ) để
   ghi `dist/THIRD_PARTY_NOTICES.txt` gồm toàn văn LICENSE của mọi package runtime được bundle (react, react-dom,
   scheduler, react-router(-dom), @tanstack/react-query, zustand, wavesurfer.js, alphaTab và các lib đi kèm nó).
   Riêng alphaTab thêm dòng "Source Code Form: https://github.com/CoderLine/alphaTab, tag v1.9.0" (MPL §3.2(a)).
   File: `apps/web/vite.config.ts`, `apps/web/package.json`.
6. **[Vi phạm] Kèm văn bản OFL cho Six Caps, Caveat, IBM Plex Mono.** Chép `@fontsource/{six-caps,caveat,ibm-plex-mono}/LICENSE`
   thành `OFL-*.txt`: vào bản build SPA (ví dụ `apps/web/public/fonts-licenses/`) và vào `dist/static/fonts/` của
   trang setup. File: `apps/web/public/` (thêm file), `apps/desktop/scripts/copy-static.mjs`.
7. **[Vi phạm] Bỏ soundfont SONiVOX khỏi bản build** (player đang tắt). Xoá `apps/web/public/soundfont/`, và kiểm
   rằng plugin `alphaTab()` không chép lại thư mục này vào `dist/`. Nếu sau này bật player thì kèm toàn văn
   Apache-2.0 và xem lại nguồn gốc file. File: `apps/web/public/soundfont/*`, `apps/web/vite.config.ts`.
8. **[Ghi công] Ghi công GuitarSet đầy đủ theo CC BY 4.0 §3(a).** Dòng `string_cnn*.pt` thêm DOI
   10.5281/zenodo.3371780, link `https://creativecommons.org/licenses/by/4.0/`, câu "weights learned from GuitarSet
   (players 00-03, with augmentation); the dataset is not redistributed". Sửa mục "Datasets" không còn ghi "not for
   training". File: `THIRD_PARTY_LICENSES.md`.
9. **[Ghi công] Cập nhật inventory cho khớp `uv.lock` và bộ cài.** FFmpeg tách theo OS; Beat This! bỏ khỏi
   "planned"; chuyển các dòng thư viện ra khỏi bảng "Evaluation data"; thêm MediaPipe và `hand_landmarker.task`,
   OpenCV, lameenc, NVIDIA CUDA (EULA), certifi/tqdm (MPL-2.0), alembic/structlog/python-multipart, SONiVOX,
   Bravura, uv (kèm đường dẫn tới file license), link mã nguồn alphaTab, ghi chú dữ liệu train của
   Demucs/PESTO/Basic Pitch/Beat This!. File: `THIRD_PARTY_LICENSES.md`.
10. **[Ghi công] Ghi lại quyết định về giấy phép thành ADR**, thay cho ADR-008 đang được dẫn chiếu nhưng không tồn
    tại. Nội dung: các quy tắc (chỉ ship LGPL, không train hay tune trên dữ liệu NC/ND, IDMT chỉ dùng để đo) và
    danh sách phải rà lại trước khi cấp phép thương mại (mục 9). File: `docs/adr/ADR-008-licensing.md` (mới; hoặc
    sửa các chỗ dẫn chiếu trong `THIRD_PARTY_LICENSES.md`, `docs/ARCHITECTURE.md`, `docs/adr/ADR-011-desktop-app.md`).
11. **[Khuyến nghị] Mục "Third-party licenses" trong app và dòng FFmpeg ở About.** Menu Help thêm mục mở
    `resources/THIRD_PARTY_LICENSES.md` và thư mục `resources/ffmpeg`. `setAboutPanelOptions` thêm `credits`: "Uses
    FFmpeg (ffmpeg.org) under the LGPL; source with each release". File: `apps/desktop/src/main.ts`.
12. **[Khuyến nghị] Nhắc FFmpeg/LGPL trên trang tải.** Cạnh nút tải thêm câu "This software uses code of FFmpeg
    licensed under the LGPL" kèm link tới bản license và tới asset mã nguồn của release (checklist FFmpeg). File:
    `site/index.html`.
13. **[Khuyến nghị] Màn hình setup nói rõ tải những gì và từ đâu.** Thêm vào danh sách: model từ Meta
    (Demucs), JKU (Beat This!), Google (MediaPipe); bản GPU kèm thư viện CUDA độc quyền của NVIDIA theo EULA của
    NVIDIA. File: `apps/desktop/static/setup.html`.
14. **[Khuyến nghị] Kiểm dòng "♪ alphaTab.net" có hiển thị.** Mở một bài trên 10 ô nhịp ở cả hai theme, kiểm
    overlay và con trỏ không che dòng này, rồi thêm một kiểm tra Playwright. Không được ẩn dòng này nếu chưa có phép
    của alphaTab. File: `apps/web/e2e/` (test mới), `apps/web/src/components/TabView.tsx` nếu cần sửa.
