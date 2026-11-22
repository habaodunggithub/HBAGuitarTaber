# Cài app không ký trên macOS, Windows và Linux hiện nay

**Ngày kiểm tra nguồn:** 2026-11-22 · **Phạm vi:** bộ cài trong `apps/desktop/electron-builder.yml` (electron-builder 26.18.0, Electron 45.2.3) · **Loại:** research, không phải quyết định

## Tóm tắt

- **macOS 15 Sequoia và macOS 26 Tahoe:** Sequoia đã bỏ cách Control-click → Open. Đường duy nhất trong giao diện là thử mở app, bấm **Done**, rồi vào **System Settings › Privacy & Security › Open Anyway** (nút chỉ hiện trong khoảng một giờ) và nhập mật khẩu. App ký ad-hoc mà chữ ký còn nguyên thì đi theo đường này. Thông báo *"is damaged"* chỉ xuất hiện khi chữ ký hỏng hoặc bundle chưa được niêm phong; lúc đó không có nút Open Anyway và phải dùng `xattr`.
- **Những gì app tự tải về** (uv, Python, wheel) không mang cờ quarantine, nên Gatekeeper không hỏi thêm. Quyết định "Open Anyway" cũng áp dụng cho mọi mã nằm trong bundle (uv, FFmpeg). Vì `hardenedRuntime: false` nên library validation không chặn gì.
- **Windows 11:** SmartScreen hiện "Windows protected your PC" › **More info** › **Run anyway**. Nếu **Smart App Control** đang bật (On) thì exe không ký sẽ bị chặn hẳn, không có nút bỏ qua cho từng app. Người dùng chỉ còn cách tắt Smart App Control. Các bản cập nhật gần đây cho phép bật lại mà không cần cài lại Windows.
- **Linux (Ubuntu 24.04):** AppImage do electron-builder 26.18 tạo theo mặc định vẫn cần gói `libfuse2t64`. Electron còn có thể vấp hạn chế user namespace của AppArmor. `.deb` thì cài được bằng double-click qua App Center (có cảnh báo "Potentially unsafe"). Một thay đổi nhỏ trong cấu hình (`toolsets.appimage`) gỡ được cả hai vướng mắc của AppImage.

Quy ước: **[chính]** là nguồn gốc (Apple, Microsoft, Canonical, mã nguồn electron-builder/AppImage). **[phụ]** là nguồn cộng đồng, chỉ dùng khi không có nguồn gốc và có ghi rõ. Chuỗi giao diện được giữ nguyên tiếng Anh, kèm tiếng Việt khi có bản dịch chính thức.

---

## 1. macOS (arm64 `.dmg`, ký ad-hoc, không notarize)

### 1.1 Cấu hình hiện tại

`mac.identity: "-"` (ký ad-hoc), `hardenedRuntime: false`, `gatekeeperAssess: false`, target `dmg` arm64, `minimumSystemVersion: "14.0"` (`apps/desktop/electron-builder.yml`).
FFmpeg trên macOS được build tĩnh bằng clang (`--enable-static --disable-shared`, `apps/desktop/scripts/build-ffmpeg-macos.sh`). Nó không kéo theo dylib nào ngoài thư viện hệ thống.

### 1.2 Control-click đã bị bỏ, "Open Anyway" là đường còn lại

- Apple (6/8/2024): *"In macOS Sequoia, users will no longer be able to Control-click to override Gatekeeper when opening software that isn't signed correctly or notarized. They'll need to visit System Settings > Privacy & Security to review security information for software before allowing it to run."* [chính] https://developer.apple.com/news/?id=saqachfa
- Hướng dẫn của Apple cho **macOS Sequoia 15** và **macOS Tahoe 26** có nội dung giống hệt nhau [chính]:
  https://support.apple.com/guide/mac-help/mh40616/15.0/mac/15.0 · https://support.apple.com/guide/mac-help/mh40616/26/mac/26
  1. *"On your Mac, choose Apple menu > System Settings, then click Privacy & Security in the sidebar. (You may need to scroll down.)"*
  2. *"Go to Security, then click Open."*
  3. *"Click Open Anyway."* Kèm ghi chú: *"This button is available for about an hour after you try to open the app."*
  4. *"Enter your login password, then click OK."*
- Bản tiếng Việt của trang macOS 26 [chính] https://support.apple.com/vi-vn/guide/mac-help/mh40616/26/mac/26: *"menu Apple > Cài đặt hệ thống … Quyền riêng tư & Bảo mật"*, *"Đi tới Bảo mật, sau đó bấm vào Mở."*, *"Bấm vào Vẫn mở."*, *"Nút này khả dụng trong khoảng một giờ sau khi bạn cố gắng mở ứng dụng."*, *"Nhập mật khẩu đăng nhập của bạn, sau đó bấm vào OK."*
- Trang "Safely open apps on your Mac" (xuất bản 27/5/2026) mô tả thêm một bước cuối: *"When the warning reappears, click Open"*. Sau đó app được lưu thành ngoại lệ, các lần sau chỉ cần double-click [chính] https://support.apple.com/en-us/102445

### 1.3 Chữ trên các hộp thoại

| Bước | Chữ hiển thị (EN) | Nguồn |
|---|---|---|
| Lần mở đầu | Thân hộp thoại: *"Apple could not verify "HBA Guitar Taber" is free of malware that may harm your Mac or compromise your privacy."* Nút **Done** / **Move to Trash** | Thân hộp thoại lấy từ một bài trên Apple Developer Forums (4/2025) [phụ, nhưng trên diễn đàn của Apple] https://developer.apple.com/forums/thread/781194. Hai nút "Move to Trash"/"Done" có trong ảnh minh hoạ của Apple, nhưng ảnh đó dùng câu cũ *"Apple cannot check 'Example App' for malicious software"* [chính] https://support.apple.com/en-us/102445 |
| Tiêu đề hộp thoại | *""HBA Guitar Taber" Not Opened"* | Chưa tìm được nguồn Apple ghi nguyên văn. **Cần chụp lại trên máy thật.** |
| Privacy & Security | Mục **Security** có một dòng báo app vừa bị chặn và nút **Open Anyway** (VI: **Vẫn mở**) | https://support.apple.com/guide/mac-help/mh40616/26/mac/26 |
| Hỏi lại lần cuối | Bấm **Open** (theo 102445) hoặc **Open Anyway** | https://support.apple.com/en-us/102445 · tác giả Eclectic Light mô tả có tới ba hộp thoại [phụ] https://eclecticlight.co/2024/10/01/living-without-notarization/ |

### 1.4 Khi nào app ad-hoc bị báo "is damaged and can't be opened"?

- Apple: *"If macOS detects that software has been modified or damaged, your Mac notifies you that the app can't be opened."* [chính] https://support.apple.com/en-us/102445. Thông báo này khác thông báo "could not verify", và **không** có nút Open Anyway đi kèm.
- Trên Apple silicon, mọi file thực thi arm64 phải có chữ ký. *"a simple ad-hoc signature is sufficient"*, nhưng *"binaries signed this way cannot pass through Gatekeeper"* [chính] https://developer.apple.com/documentation/macos-release-notes/macos-big-sur-11_0_1-universal-apps-release-notes.md. Nghĩa là app ad-hoc **luôn** bị Gatekeeper chặn ở lần mở đầu, và người dùng gỡ chặn bằng Open Anyway như ở trên. Riêng việc ký ad-hoc không gây ra thông báo "damaged".
- Thông báo "damaged" xuất hiện khi chữ ký của bundle không khớp với nội dung. Vài trường hợp thường gặp:
  - Bundle chỉ mang chữ ký do linker gắn cho từng binary, chưa bao giờ được niêm phong cả bundle. Đây là trường hợp của electron-builder với `identity: null`. Nhiều issue của các dự án độc lập báo rằng chuyển sang ký ad-hoc toàn bundle thì thông báo đổi từ "damaged" sang "could not verify" [phụ] https://github.com/YueMiyuki/Risuko/issues/164 · https://github.com/vGsteiger/RamDoc/pull/545. Tài liệu electron-builder cũng ghi rõ: không có chứng chỉ thì electron-builder **không** tự ký ad-hoc, phải đặt identity `"-"` [chính] https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/code-signing/code-signing-mac.md
  - Bundle bị sửa sau khi ký, hoặc bị nén rồi giải nén bằng công cụ làm hỏng chữ ký. Quinn (Apple DTS) viết: *"just compressing and decompressing the app broke its code signature"*. Ông cũng khuyên chỉ dùng tên file ASCII trong bundle vì lỗi chuẩn hoá Unicode trong cơ chế ký [chính] https://developer.apple.com/forums/thread/706379
- **Repo này:** đặt `identity: "-"` là đúng hướng để tránh thông báo "damaged". Hiện CI chưa có bước nào xác nhận bundle được niêm phong đúng (xem đề xuất M1).
- Nếu vẫn gặp "damaged", cách xử lý thực tế là gỡ cờ quarantine:
  `xattr -dr com.apple.quarantine "/Applications/HBA Guitar Taber.app"`
  Quinn mô tả đây là cách dùng khi kiểm thử. Ông cũng ghi chú rằng thuộc tính `com.apple.quarantine` *"is not documented as API"* [chính] https://developer.apple.com/forums/thread/706442. Gỡ quarantine *"bypasses first run checks that could spot malware"* [phụ] https://eclecticlight.co/2024/10/01/living-without-notarization/. Vì vậy chỉ đưa lệnh này vào mục "Gặp lỗi", không đưa vào luồng chính.

### 1.5 Quarantine có áp dụng cho file app tự tải, cho uv và FFmpeg đi kèm không?

- **Mã nằm trong bundle (uv, FFmpeg, file thực thi trong `Resources/`):** *"If the user allows the app to run, Gatekeeper records that decision and applies it to the app and any code within the app, including your tool."* [chính] https://developer.apple.com/forums/thread/706379. Vậy sau Open Anyway, uv và FFmpeg không bị hỏi thêm.
- **Python, wheel, `.so`/`.dylib` do uv tải về:** quarantine do chính ứng dụng gắn vào file nó tải. Quinn viết: *"Unix-y networking tools, like `curl` and `scp`, don't quarantine the files they download"* [chính] https://developer.apple.com/forums/thread/706442. Một app chỉ tự gắn quarantine cho file nó tạo khi có khoá Info.plist `LSFileQuarantineEnabled` (*"whether the files this app creates are quarantined by default"*) [chính] https://developer.apple.com/tutorials/data/documentation/bundleresources/information-property-list/lsfilequarantineenabled.json. uv dùng HTTP client riêng nên file nó tải không mang quarantine, và Gatekeeper không hỏi gì khi chạy Python. Đây là suy luận từ hai nguồn trên. CI smoke test trên `macos-15` đã chạy đúng đường này, chỉ khác là bản thân app trong CI không bị quarantine.
- **Lưu ý:** Gatekeeper vẫn *"tracks the provenance of files written by downloaded software"*, và *"all software in macOS is checked for known malicious content the first time it's opened"* (quét XProtect). Hai việc này không hiện hộp thoại nếu file sạch [chính] https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web
- **Library validation:** *"The Hardened Runtime enables library validation by default"*. Library validation chặn nạp thư viện không do Apple ký hoặc không cùng Team ID [chính] https://developer.apple.com/tutorials/data/documentation/bundleresources/entitlements/com.apple.security.cs.disable-library-validation.json. Repo đặt `hardenedRuntime: false`, và các tiến trình Python do app spawn đều là binary của python-build-standalone, không bật hardened runtime. Library validation vì thế không chặn `.so` của torch hay numpy. Dù vậy, trên arm64 mỗi Mach-O vẫn phải có chữ ký hợp lệ (ad-hoc là đủ), theo release notes Big Sur ở trên.
- **App Translocation:** *"When necessary, Gatekeeper opens apps from randomized, read-only locations"* [chính] https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web. Điều này xảy ra khi người dùng mở app thẳng từ DMG hoặc từ Downloads. Nên hướng dẫn kéo app vào Applications trước khi mở.

### 1.6 Ký ad-hoc cùng các helper của Electron

- electron-builder: khi `identity: "-"` và **hardened runtime bật**, Electron Framework sẽ không khớp Team ID (*"mapping process and mapped file (non-platform) have different Team IDs"*). Vì vậy electron-builder tự thêm entitlement `allow-jit` và `disable-library-validation` cho app và các binary lồng bên trong. Một cách khác là đặt `hardenedRuntime: false` [chính] https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/code-signing/code-signing-mac.md
- Repo đã chọn `hardenedRuntime: false` nên không gặp lỗi Team ID nói trên. Hardened runtime chỉ bắt buộc khi notarize (*"required for notarization on macOS 10.15+"*) [chính] https://github.com/electron-userland/electron-builder/blob/master/website/docs/mac.md
- Hai nguồn mâu thuẫn nhau: `website/docs/mac.md` của electron-builder ghi bản ad-hoc *"will only run on the machine that built it"*, còn Apple viết chữ ký ad-hoc *"can be verified on any other system"* (release notes Big Sur ở trên). Ở đây tin nguồn Apple. Thực tế cũng vậy: app chạy được trên máy khác sau Open Anyway.
- Bạn của dự án hiện chưa phải bước nào thêm. Khi có Developer ID thì bật lại hardened runtime và notarize (ADR-011, action 7).

### 1.7 Có nên phát hành `.zip` thay cho hoặc kèm `.dmg`?

- Zip không giúp gì về quarantine. Quinn: *"if Safari downloads a zip archive, it quarantines that archive"*. Chỉ các công cụ Unix như `unzip` mới không truyền quarantine sang file giải nén, còn người dùng bình thường giải nén bằng Finder [chính] https://developer.apple.com/forums/thread/706442
- Zip còn có rủi ro làm hỏng chữ ký nếu bị nén lại bằng công cụ khác (đoạn trích của Quinn ở 1.4). DMG giữ nguyên bundle đã ký.
- electron-builder cần `zip` chủ yếu cho auto-update qua Squirrel.Mac: *"The default targets are `zip` and `dmg` (both are required for Squirrel.Mac auto-update)"* [chính] https://github.com/electron-userland/electron-builder/blob/master/website/docs/mac.md. Repo đặt `publish: null` và không dùng electron-updater.
- **Kết luận:** giữ `.dmg`, chưa cần `.zip`.

---

## 2. Windows 11 (NSIS `.exe` không ký, cài cho người dùng hiện tại)

### 2.1 SmartScreen với exe không ký và chưa có uy tín

- Microsoft: với file *"No signature"*: *"Warning — "Windows protected your PC"; User must choose "Run anyway" before the app can run. Enterprise policy can prevent continuation entirely."* [chính] https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation (ms.date 2026-05-04)
- Cách uy tín được tích luỹ: *"When a file is not signed, SmartScreen reputation must build for each new version of your files, starting with zero reputation."* Thời gian: *"There is no exact threshold, but it can take several weeks and hundreds of clean installs from a wide audience."* Microsoft cũng ghi: *"There is no need (or mechanism) to manually submit a file for SmartScreen reputation review for consumer endpoints."* (cùng nguồn). **Hệ quả:** mỗi bản phát hành mới lại bắt đầu từ con số không.
- SmartScreen chỉ kiểm file tải từ Internet. Dấu hiệu nhận biết là Mark of the Web, chỉ gắn cho file thuộc zone Internet hoặc Restricted [chính] https://learn.microsoft.com/en-us/deployoffice/security/internet-macros-blocked · https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/. File do bộ cài NSIS ghi ra và file uv tải về không mang dấu này, nên SmartScreen chỉ hỏi một lần cho bộ cài. Đây là suy luận, cần xác nhận trên máy thật.
- **Luồng người dùng thấy**: hộp thoại xanh **"Windows protected your PC"** › bấm **More info** › hiện tên app và *"Publisher: Unknown publisher"* › bấm **Run anyway**. Các bước này khớp với bảng của Microsoft ở trên. Chữ "Unknown publisher" và bản dịch tiếng Việt của hộp thoại **chưa có nguồn chính thức**, nên chụp lại trên máy thật.
- Bộ cài có `perMachine: false` và `oneClick: false`. Theo mã electron-builder, tổ hợp này **hiện trang chọn chế độ cài** chứ không cài thẳng cho user. Mặc định chọn sẵn **"Only for me (<tên user>)"**. Lựa chọn còn lại là **"Anyone who uses this computer (all users)"**, kèm dòng *"Fresh install for all users. (will prompt for admin credentials)"* [chính] https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.18.0/packages/app-builder-lib/src/targets/win/nsis/nsisOptions.ts · https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.18.0/packages/app-builder-lib/templates/nsis/multiUserUi.nsh · https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.18.0/packages/app-builder-lib/templates/nsis/assistedMessages.yml. Comment trong `electron-builder.yml` (*"per user: no admin prompt"*) chỉ đúng khi người dùng giữ nguyên lựa chọn mặc định.

### 2.2 Smart App Control (SAC)

- SAC chặn hẳn, không có nút bỏ qua: *"Malware, Potentially Unwanted Apps (PUA), and unknown, unsigned code are blocked by default."* [chính] https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview (ms.date 2026-09-30). Trang hỗ trợ viết *"There is currently no way to bypass Smart App Control protection for individual apps."* (VI: *"Hiện không có cách nào để bỏ qua chức năng bảo vệ của Kiểm soát Ứng dụng Thông minh đối với từng ứng dụng."*) [chính] https://support.microsoft.com/en-us/windows/what-is-smart-app-control-285ea03d-fa88-4d56-882e-6698afdb7003 · https://support.microsoft.com/vi-vn/windows/what-is-smart-app-control-285ea03d-fa88-4d56-882e-6698afdb7003
- SAC kiểm **mọi** file thực thi, không riêng file tải về: *"Smart App Control will block execution of unsigned files unless the file has a positive reputation. Smart App Control signature checks apply to all executable files, not just those downloaded from the Internet."* [chính] https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation. Nó dựa trên App Control for Business, vốn kiểm cả `.exe` và `.dll` [chính] https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/appcontrol. Hệ quả: khi SAC ở chế độ On, có thể chính bộ cài đã bị chặn. Nếu không, `uv.exe`, `python.exe` hay các DLL/`.pyd` không ký cũng có thể bị chặn, trừ khi dịch vụ đám mây của Microsoft đã biết chúng. **Chưa kiểm trên máy thật.**
- Máy nào bật SAC: SAC có từ Windows 11 22H2 và *"starts in evaluation mode and switches off within 48 hours for enterprise managed devices unless the user turns it on first"* [chính] https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/appcontrol. Ở chế độ Evaluation, nếu Windows thấy người dùng không hợp (developer, doanh nghiệp…) thì *"we'll automatically turn Smart App Control off"*. Xem trạng thái tại **Settings › Windows Security › App and Browser Control**, mục **Smart App Control**, với ba giá trị On / Evaluation / Off [chính] https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview. Bản tiếng Việt gọi là **"Kiểm soát Ứng dụng Thông minh"** trong **"Bảo mật Windows"** › **"Điều khiển Trình duyệt & Ứng dụng"** (trang vi-vn ở trên).
- Bật lại sau khi tắt: trước đây tắt SAC là không bật lại được nếu không cài lại Windows. Trang hỗ trợ hiện ghi *"Recent Windows updates allow Smart App Control to be re‑enabled without requiring a clean installation."* Trường hợp ngoại lệ là SAC tắt vì người dùng đã tắt optional diagnostic data, khi đó *"you'll need to reset this PC, or reinstall Windows"* [chính] https://support.microsoft.com/en-gb/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions. Có một lỗi đã biết: sau bản cập nhật tháng 10/2026 (KB5127648), *"the option to turn on Smart App Control might be grayed out"*. Lỗi được sửa bằng bản cập nhật từ 28/10/2026 (26H2/25H2) và từ 10/11/2026 (24H2) [chính] https://support.microsoft.com/en-us/servicing/os/windows-11/2026/10/kb5127648-windows-11-24h2-25h2-26h2-security-update. Báo chí đưa tin trái chiều về việc tính năng này rút lại rồi đưa trở lại (ví dụ https://windowsreport.com/smart-app-control-still-requires-clean-windows-11-install-after-microsoft-reversal/ [phụ]). Trang hướng dẫn nên viết thận trọng: "trên Windows đã cập nhật đầy đủ thường bật lại được".

### 2.3 Defender báo nhầm (false positive)

- Không có số liệu chính thức về tần suất Defender báo nhầm bộ cài NSIS hay app Electron. Dự án NSIS tự ghi: *"There are hundreds of false positive made with NSIS"*. Nguyên nhân là một số hãng antivirus *"still generate signatures on the installer stub itself instead of the files in it"*, nên một stub bị gắn cờ là mọi bộ cài cùng phiên bản NSIS đều dính theo. Cách khắc phục được nêu là báo cho hãng (thường sửa nhanh) và ký mã (*"There have been reports it helps"*) [chính, trang wiki của dự án NSIS, sửa lần cuối 31/7/2023] https://nsis.sourceforge.io/NSIS_False_Positives
- Gửi báo nhầm cho Microsoft: nộp file qua https://www.microsoft.com/wdsi/filesubmission, chọn vai trò **software developer**, và phải đăng nhập. Nếu không đồng ý kết luận thì dùng *"developer contact form provided with the submission results"*. Theo dõi tiến trình tại https://www.microsoft.com/wdsi/submissionhistory [chính] https://learn.microsoft.com/en-us/defender-xdr/submission-guide. Riêng cảnh báo SmartScreen sai thì *"make sure to select Microsoft Defender SmartScreen from the product menu"* [chính] https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/
- Phía người dùng, khi Defender đã cách ly file: vào **Windows Security › Virus & threat protection › Protection history**, chọn **Restore** hoặc **Allow on device**. Bước này cần quyền admin, và lịch sử chỉ giữ hai tuần [chính] https://support.microsoft.com/en-us/windows/security/windows-security/protection-history-in-the-windows-security-app

### 2.4 Nếu sau này muốn ký (để tham khảo, không phải đề xuất)

Microsoft gọi Artifact Signing (tên cũ Trusted Signing) là *"Microsoft's recommended code signing service for non-Store distribution"*, giá *"Starts at $9.99/month"*. Ký chỉ giúp uy tín được cộng dồn giữa các phiên bản, không xoá cảnh báo ngay. Ngoài ra *"EV certificates no longer bypass SmartScreen"* [chính] https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation. Dịch vụ cần subscription Azure trả phí và có danh sách quốc gia được hỗ trợ [chính] https://learn.microsoft.com/en-us/azure/artifact-signing/faq. Chưa kiểm Việt Nam có trong danh sách hay không.

---

## 3. Linux (AppImage và `.deb` x64)

### 3.1 AppImage trên Ubuntu 24.04

- **Quyền chạy:** vào Properties › Permissions, bật *"Allow executing file as program"* (Nautilus) rồi double-click file. Hoặc dùng terminal: `chmod +x my.AppImage` rồi `./my.AppImage` [chính] https://docs.appimage.org/introduction/quickstart.html. Trên Files của GNOME 46 (Ubuntu 24.04), tên công tắc có thể khác; cần chụp lại.
- **FUSE:** thiếu FUSE thì AppImage báo *"AppImages require FUSE to run."* Tài liệu ghi: *"In Ubuntu 24.04, the libfuse2 package was renamed to libfuse2t64."* Cài bằng `sudo apt install libfuse2t64`. Dù thế nào, `--appimage-extract-and-run` vẫn chạy được mà không cần FUSE [chính] https://docs.appimage.org/user-guide/troubleshooting/fuse.html
- **electron-builder 26.18.0 mặc định vẫn dùng runtime FUSE 2 cũ:** `toolsets.appimage` có `@default "0.0.0"` (bản legacy). Hai bản `1.0.2`/`1.0.3` (runtime 20251108) vẫn đang gắn nhãn *Betas* [chính] https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.18.0/packages/app-builder-lib/src/configuration.ts. Runtime mới thì *"Since the runtime is linked statically, libfuse2 is no longer required on the target system."* [chính] https://github.com/AppImage/type2-runtime
- **Hạn chế user namespace của AppArmor:** *"the Ubuntu kernel now restricts the use of unprivileged user namespaces … This affects all programs on the system that are unprivileged and unconfined."* Tài liệu đưa ra ba cách xử lý: profile AppArmor `unconfined` + `userns`, chạy `--no-sandbox` (*"not recommended"*), hoặc tắt sysctl cho toàn máy [chính] https://documentation.ubuntu.com/release-notes/24.04/. Electron đóng issue gốc và để việc xử lý cho các công cụ đóng gói [chính] https://github.com/electron/electron/issues/41066
  - electron-builder PR #9590 (merge 14/3/2026, có từ 26.9.0) cho AppRun tự thêm `--no-sandbox` khi `unshare -Ur true` thất bại. Khi dùng toolset mới, PR cũng bỏ `--no-sandbox` cố định khỏi file `.desktop`. Phần dò này chỉ nằm trong đường build của toolset mới (`appImageUtil.ts`). Toolset `0.0.0` vẫn giữ `--no-sandbox` cố định trong `.desktop` [chính] https://github.com/electron-userland/electron-builder/pull/9590
  - Mô tả PR cho rằng mở AppImage từ trình quản lý file thì không vướng hạn chế này, vì Nautilus có profile *unconfined* cho phép userns [chính, Canonical] https://discourse.ubuntu.com/t/understanding-apparmor-user-namespace-restriction/58007. Mở từ terminal thì có thể vướng. **Cần thử trên Ubuntu 24.04 thật** với bản build hiện tại.

### 3.2 `.deb` trên Ubuntu 24.04

- Double-click được: App Center (snap `snap-store`) đã hỗ trợ cài `.deb` cục bộ từ giữa năm 2024. Issue "Support installing local deb packages" đóng ngày 12/7/2024 với trạng thái *completed* [chính] https://github.com/ubuntu/app-center/issues/1407. Hai PR liên quan là https://github.com/ubuntu/app-center/pull/1680 và https://github.com/ubuntu/app-center/pull/1681. App Center là snap nên các bản sửa đến tay người dùng mà không phải chờ bản point release.
- Chữ hiển thị (chuỗi gốc trong mã App Center) [chính] https://github.com/ubuntu/app-center/blob/main/packages/app_center/lib/src/l10n/app_en.arb:
  - Banner **"Potentially unsafe"**: *"This package is provided by a third party. Installing packages from outside the App Center can increase the risk to your system and personal data. Ensure you trust the source before proceeding."*
  - Hộp thoại: *"This package is provided by a third party and may threaten your system and personal data."* / *"Are you sure you want to install it?"*, sau đó nhập mật khẩu.
- Một lỗi cần biết khi cập nhật: đến tháng 10/2026, App Center vẫn coi `.deb` mới là *Installed* khi máy đã có gói cùng tên khác phiên bản. Lỗi được sửa trong PR #2217, merge 23/10/2026 [chính] https://github.com/ubuntu/app-center/pull/2217. Người dùng có App Center cũ hơn bản sửa sẽ không cập nhật được bằng double-click. Lệnh dự phòng là `sudo apt install ./HBA-Guitar-Taber-<version>-linux-*.deb` (bắt buộc có `./`).
- Lỗi cài thì có thể bị treo ở vòng xoay mà không báo gì (ví dụ cài nhầm kiến trúc). PR sửa lỗi này vẫn đang mở [chính] https://github.com/ubuntu/app-center/pull/2118
- Gói `.deb` của electron-builder có profile AppArmor từ v26.0, cài trong post-install, và đã có bản sửa thêm dấu ngoặc quanh đường dẫn có khoảng trắng (#9231, bản 26.0.20) [chính] https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/CHANGELOG.md. Dự án này cài vào `/opt/HBA Guitar Taber`, đường dẫn có khoảng trắng, nên bản sửa đó có liên quan trực tiếp. `.deb` vì thế không vướng hạn chế userns như AppImage.

---

## 4. Hướng dẫn đề xuất cho trang cài đặt

> Mọi bước dưới đây là **đề xuất** cho nội dung trang, chưa phải quyết định. Chữ giao diện in đậm theo tiếng Anh; tiếng Việt đặt trong ngoặc khi có bản dịch chính thức.

### macOS 14+ (Apple silicon)

1. Tải `HBA-Guitar-Taber-<version>-mac-arm64.dmg`, mở file DMG, **kéo HBA Guitar Taber vào thư mục Applications**, rồi đẩy (eject) DMG ra.
2. Mở app từ Applications. macOS báo *"Apple could not verify "HBA Guitar Taber" is free of malware…"*. Bấm **Done** (không bấm Move to Trash).
3. Trong vòng một giờ, vào **Apple menu › System Settings › Privacy & Security** (Cài đặt hệ thống › Quyền riêng tư & Bảo mật). Kéo xuống mục **Security** (Bảo mật), bấm **Open Anyway** (Vẫn mở), nhập mật khẩu đăng nhập, bấm **OK**.
4. Nếu macOS hỏi lại lần nữa, bấm **Open**.
5. Lần đầu mở, app tải bộ máy phân tích (0,3–4 GB). Bước này không có hộp thoại bảo mật nào khác.
6. Mỗi bản cập nhật tải về sẽ phải làm lại bước 2–4. Đây là suy luận, vì Apple chỉ nói app được lưu làm "exception".
7. *Gặp lỗi:* nếu thấy **"HBA Guitar Taber is damaged and can't be opened"** và không có nút Open Anyway, mở Terminal, chạy
   `xattr -dr com.apple.quarantine "/Applications/HBA Guitar Taber.app"`, rồi mở lại app. Đồng thời báo lỗi cho dự án, vì thông báo này cho thấy bản build có vấn đề.

### Windows 10/11 x64

1. Tải `HBA-Guitar-Taber-<version>-win-x64.exe` rồi mở.
2. Thấy **"Windows protected your PC"** thì bấm **More info**, rồi **Run anyway**.
3. Ở trang chọn chế độ cài, giữ **"Only for me"** để khỏi bị hỏi quyền admin. Đồng ý giấy phép rồi cài.
4. *Không có nút Run anyway, hoặc Windows báo app bị chặn:* có thể **Smart App Control** đang bật. Kiểm tra ở **Windows Security › App & browser control › Smart App Control** (Bảo mật Windows › Điều khiển Trình duyệt & Ứng dụng › Kiểm soát Ứng dụng Thông minh). Microsoft không cho bỏ qua SAC cho từng app. Muốn cài thì phải tắt SAC. Trên Windows cập nhật đầy đủ thường bật lại được sau đó.
5. *Defender xoá hoặc cách ly file:* vào **Windows Security › Virus & threat protection › Protection history**, chọn mục đó › **Restore** / **Allow on device** (cần quyền admin). Nên kiểm SHA-256 với `SHA256SUMS.txt` trước khi làm việc này.

### Linux x64

- **Ubuntu/Debian, khuyến nghị dùng `.deb`:** double-click file `.deb` › App Center hiện cảnh báo **"Potentially unsafe"** › **Install** › nhập mật khẩu. Nếu App Center không phản hồi, chạy `sudo apt install ./HBA-Guitar-Taber-<version>-linux-*.deb`.
- **AppImage (mọi distro):** chuột phải › Properties › bật quyền chạy (hoặc `chmod +x HBA-Guitar-Taber-*.AppImage`) › double-click. Trên Ubuntu 24.04, nếu báo *"AppImages require FUSE to run"* thì chạy `sudo apt install libfuse2t64` (Ubuntu 22.04 dùng `libfuse2`).

---

## 5. Những thay đổi rẻ trong build giúp bớt vướng (đều là **đề xuất**)

- **M1 (đề xuất, macOS):** thêm vào CI, ngay sau `electron-builder`, lệnh `codesign --verify --deep --strict --verbose=2 "release/mac-arm64/HBA Guitar Taber.app"`. Bước này bắt lỗi niêm phong, nguyên nhân sinh ra "damaged", trước khi phát hành. Quinn coi đây là bước đầu tiên khi điều tra Gatekeeper [chính] https://developer.apple.com/forums/thread/706379. Có thể thêm `syspolicy_check distribution` để xem báo cáo, biết trước là sẽ trượt vì thiếu notarize [chính] https://developer.apple.com/forums/thread/706442.
- **M2 (đề xuất, macOS):** giữ `.dmg`, không thêm `.zip`. Lý do ở mục 1.7.
- **M3 (đề xuất, macOS):** giữ nguyên tắc không ghi gì vào bên trong `.app` lúc chạy. Ví dụ không để Python ghi `__pycache__` vào `Resources/python`, có thể đặt `PYTHONDONTWRITEBYTECODE=1` cho tiến trình chạy từ Resources. Ghi vào bundle sẽ phá niêm phong. Theo ADR-011, runtime đã nằm ngoài bundle. Mục này chỉ để kiểm lại, chưa thấy lỗi thật.
- **L1 (đề xuất, Linux):** đặt `toolsets: { appimage: "1.0.3" }` trong `electron-builder.yml`. Thay đổi này dùng runtime tĩnh nên bỏ được yêu cầu `libfuse2t64`, đồng thời bật cơ chế tự dò `--no-sandbox` của #9590. Đổi lại, toolset này vẫn gắn nhãn beta ở 26.18. Cần smoke test AppImage trên Ubuntu 24.04 trước khi phát hành.
- **L2 (đề xuất, trang tải):** trên Ubuntu/Debian, giới thiệu `.deb` trước AppImage, vì `.deb` có profile AppArmor và không cần FUSE.
- **W1 (đề xuất, Windows):** trước khi Publish Release nháp, nộp `.exe` lên https://www.microsoft.com/wdsi/filesubmission (vai trò software developer) nếu Defender gắn cờ. Không cần nộp để lấy uy tín SmartScreen, vì Microsoft nói không có cơ chế đó.
- **W2 (đề xuất, Windows):** sửa comment `perMachine: false # per user: no admin prompt` cho đúng với trang chọn chế độ cài. Nếu muốn bỏ hẳn trang này, cân nhắc `oneClick: true` + `perMachine: false`. Theo `nsisOptions.ts`, cách này cài thẳng cho user nhưng mất trang license và trang chọn thư mục. Đây là đánh đổi UX, cần quyết định.
- **S1 (đề xuất, trang tải):** viết lại các chuỗi `fo.win`/`fo.mac` trong `site/index.html`, thêm "trong vòng một giờ", "nhập mật khẩu", "kéo vào Applications trước", và một dòng về Smart App Control.

## 6. Chưa kiểm được, cần làm trên máy thật

1. Tiêu đề chính xác của hộp thoại Gatekeeper trên macOS 15 và 26 (EN và VI), và dòng chữ trong mục Security của Privacy & Security.
2. Bản build ad-hoc hiện tại thực sự hiện "could not verify" hay "damaged" khi tải bằng Safari hoặc Chrome trên macOS 15 và 26.
3. Chữ trên hộp thoại SmartScreen bằng tiếng Việt, và việc có dòng "Publisher: Unknown publisher" hay không.
4. Trên máy có SAC = On: bộ cài bị chặn hay chạy được. Nếu cài được thì `uv.exe`, `python.exe`, các DLL torch có bị chặn không.
5. AppImage bản hiện tại (toolset `0.0.0`) trên Ubuntu 24.04 sạch: mở từ Files và từ terminal, có hay không có `libfuse2t64`.
