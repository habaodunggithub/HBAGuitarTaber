# Quét VirusTotal cho mỗi bản phát hành

Ngày kiểm tra nguồn: **2026-11-22**. Mọi trích dẫn bên dưới đều lấy từ trang gốc vào ngày này.

## Tóm tắt và khuyến nghị

- Public API miễn phí cho upload tới **650 MB** qua `/files/upload_url` (bắt buộc với file > 32 MB, tức cả 4 bộ cài 170–235 MB của ta). Giới hạn là **4 request/phút và 500 request/ngày**. Dự án phi thương mại có đóng góp file mới thì dùng được, kể cả từ CI.
- File upload lên sẽ được chia sẻ với các đối tác antivirus, và khách hàng premium có thể tải về. Bộ cài của ta vốn đã công khai trên GitHub Releases và mã nguồn cũng công khai, nên điều này gần như không làm lộ thêm gì.
- Có thể dựng link báo cáo chỉ từ SHA-256 (`https://www.virustotal.com/gui/file/<sha256>/detection`), với điều kiện file đã có người upload. Vì vậy vẫn cần một bước upload.
- **Khuyến nghị: thêm một bước tự động vào job `release` của `desktop.yml`**, giữa "Checksums" và "Draft the release". Bước này là script `curl` tự viết, không dùng action bên thứ ba: upload 4 bộ cài, rồi ghi link dựng từ `SHA256SUMS.txt` vào phần ghi chú của Release nháp. Như vậy bạn xem kết quả VirusTotal *trước khi* bấm Publish. Nếu chưa có secret `VT_API_KEY` thì bước này tự bỏ qua, và bạn làm tay như mục 5.

## 1. Public API: kích thước file, quota, điều khoản

### Kích thước

- `POST /files` chỉ dành cho file nhỏ: "If the file to be uploaded is bigger than 32MB, please use the /files/upload_url endpoint instead which admits files up to 650MB." ([Upload a file](https://docs.virustotal.com/reference/files-scan))
- 650 MB đúng là trần: "although the actual size limit is 650MBs, files larger than 200MBs tend to be bundles of some sort ... it makes sense to upload the inner individual files instead". Lý do được nêu là "Engines tend to have performance issues on big files (timeouts, some may not even scan them)". Mỗi upload URL "can be used only once" và nằm trong trường `data` của response. ([Get a URL for uploading large files](https://docs.virustotal.com/reference/files-upload-url))
  - Hệ quả với ta: bộ cài 235 MB vẫn nằm dưới trần. Tuy vậy, có thể vài engine timeout trên file lớn như vậy. Ta vẫn upload nguyên bộ cài, vì báo cáo cần khớp đúng SHA-256 của file người dùng tải về.
- FAQ về file lớn cũng nhắc lại rằng muốn upload file lớn qua API thì phải dùng `files-upload-url`. ([Should I upload files larger than 650MBs?](https://docs.virustotal.com/docs/large-files))

### Quota

- "The Public API is limited to **500 requests per day and a rate of 4 requests per minute**." ([Public vs Premium API](https://docs.virustotal.com/reference/public-vs-premium-api))
- Quota API có ba mức: phút, ngày, tháng. Quota ngày reset lúc 00:00 UTC. Khi hết quota, API v3 trả về `429`. ([How consumption quotas are handled](https://docs.virustotal.com/docs/consumption-quotas-handled); [Errors](https://docs.virustotal.com/reference/errors), mã `QuotaExceededError`.) Trang Public vs Premium không ghi con số quota tháng cho public API.
- Tài liệu không nói rõ một lần POST tới upload URL có bị tính là một request riêng hay không. Để an toàn, cứ tính 3 request cho mỗi file (tra hash, lấy upload URL, upload). Với 4 bộ cài là khoảng 12 request mỗi lần phát hành, thấp hơn nhiều so với 500/ngày.

### Điều khoản dùng public API (CI, thương mại hay phi thương mại)

- "The Public API **must not** be used in commercial products or services. The Public API **must not** be used in business workflows that do not contribute new files. You are not allowed to register multiple accounts to overcome the aforementioned limitations." ([Public vs Premium API](https://docs.virustotal.com/reference/public-vs-premium-api))
- "The public API is a free service, available for any website or application that is free to consumers. The API must not be used in commercial products or services, it can not be used as a substitute for antivirus products ..." ([API Overview](https://docs.virustotal.com/docs/api-overview); [Getting started](https://docs.virustotal.com/reference/getting-started) có câu tương tự)
- Bảng so sánh ghi Public API dành cho "Non-commercial, or academic use". ([Public vs private API](https://docs.virustotal.com/docs/difference-public-private))
- Không trang nào nhắc đến CI. Không có điều khoản cấm tự động hóa: "Submissions may be scripted in any programming language using the HTTP-based public API." ([How it works](https://docs.virustotal.com/docs/how-it-works))
- Đánh giá cho dự án này: HBA Guitar Taber miễn phí cho người dùng và phi thương mại (xem `LICENSE`: "Free to use, non-commercial, no derivatives"). Mỗi lần phát hành ta đóng góp file mới. Theo các trang trên, việc này nằm trong phạm vi được phép. Nếu sau này app có bản trả phí thì phải xem lại, vì khi đó có thể cần gói trả phí (gói VT Lite giá "From $5k", theo [blog VirusTotal, 2025-10-08](https://blog.virustotal.com/2025/10/simpler-access-for-stronger-virustotal.html)).
- Lưu ý về nguồn: link "Terms of Service" trên docs ([docs.virustotal.com/docs/terms-of-service](https://docs.virustotal.com/docs/terms-of-service)) hiện chuyển hướng 301 sang `cloud.google.com/terms/secops`, rồi tiếp sang [Google Cloud Platform Terms](https://cloud.google.com/terms), một văn bản chung không riêng cho người dùng VirusTotal miễn phí. Văn bản ToS riêng của VirusTotal mà tôi đọc được là bản [Historic Terms of Service](https://docs.virustotal.com/docs/historic-terms-of-service) ("Last Updated January 27, 2021"). Các câu trích ToS bên dưới lấy từ bản đó. Phần quota và điều khoản API lấy từ các trang API (cập nhật 2025-12).

### Chia sẻ file với đối tác (quyền riêng tư)

- "if you submitting any Sample, the Sample is immediately shared for review by the Service's Partners, and the resulting intelligence report is shared with you and, and with the Partners" ([Historic Terms of Service](https://docs.virustotal.com/docs/historic-terms-of-service))
- "YOU FURTHER AGREE THAT YOU WILL ONLY UPLOAD SAMPLES THAT YOU WISH TO PUBLICLY SHARE AND ... WILL NOT KNOWINGLY SUBMIT ANY SAMPLE ... THAT CONTAINS CONFIDENTIAL OR COMMERCIALLY SENSITIVE DATA" (cùng nguồn)
- "The contents of submitted files or pages may also be shared with premium VirusTotal customers ... tools to perform complex criteria-based searches to identify and access harmful files samples" ([How it works](https://docs.virustotal.com/docs/how-it-works)). Premium API còn "Enables you to download submitted samples" ([Public vs Premium API](https://docs.virustotal.com/reference/public-vs-premium-api)).
- Trang upload của API v3 ghi: "Any IoC submitted or queried via the API will be scanned and added to the VirusTotal dataset, making it accessible to the community. Do not submit or query indicators containing sensitive, confidential, or personally identifiable information". Trang này cập nhật 2026-09-24. ([Upload a file](https://docs.virustotal.com/reference/files-scan))
- Upload nhầm file nhạy cảm thì chỉ có cách gửi form yêu cầu xóa, không có nút xóa. ([Accidental upload](https://docs.virustotal.com/docs/accidental-upload))
- Hệ quả với ta: repo `habaodunggithub/HBAGuitarTaber` để public (kiểm bằng `gh repo view`), và bộ cài phát công khai trên Releases. App không đóng mã nguồn; mã được công khai theo giấy phép non-commercial. Vì vậy upload lên VirusTotal không làm lộ thứ gì chưa công khai. Chỉ có hai điều cần để ý:
  1. Nếu upload ở bước Release nháp thì bộ cài đến tay đối tác của VirusTotal vài phút trước khi bạn bấm Publish.
  2. Không được để secret nào (token, key) lọt vào bộ cài. Điều này đằng nào cũng phải đảm bảo, vì bộ cài là file công khai.
- Có dịch vụ upload riêng tư (Private Scanning, `/private/files`), nhưng nó "will NOT contain our multi-antivirus or url-scan partners verdicts", và báo cáo "only visible to users within your organization" ([Private Scanning](https://docs.virustotal.com/docs/private-scanning)). Cả hai điểm đều trái với mục tiêu công bố link kết quả antivirus, nên ta không dùng.

## 2. Link báo cáo dựng từ SHA-256

- FAQ chính thức: "How can I link to the most recent report on a given file or URL?" trả lời bằng `https://www.virustotal.com/gui/file/<resource>/detection`, trong đó resource là "The SHA256 of a given file that was scanned by VirusTotal" (MD5 và SHA1 cũng được). ([Most recent report](https://docs.virustotal.com/docs/most-recent-report))
- API `GET /files/{id}` nhận "SHA-256, SHA-1 or MD5 identifying the file". Có thể dùng endpoint này để kiểm xem VirusTotal đã biết file chưa, trước khi quyết định upload. ([Get a file report](https://docs.virustotal.com/reference/file-info))
- Kết luận: link dựng được hoàn toàn từ dòng tương ứng trong `SHA256SUMS.txt`, và luôn trỏ tới phân tích mới nhất. Nhưng điều kiện là file "was scanned by VirusTotal", nên ít nhất một lần upload là bắt buộc. Người dùng còn tự đối chiếu được hash trên trang VirusTotal với `SHA256SUMS.txt`.
- Sau khi upload, kết quả có trạng thái `queued`, sau đó `in-progress`, rồi `completed` ([Analyses object](https://docs.virustotal.com/reference/analyses-object)). Tài liệu không nêu thời gian quét. Vì thế khi bạn mở link ngay sau khi CI chạy xong, có thể vẫn thấy kết quả chưa đầy đủ.
- Nếu có engine báo nhầm: bấm Reanalyse, rồi khiếu nại trực tiếp với hãng đó, vì VirusTotal "cannot modify or remove detections made by third-party antivirus engines" ([False positive](https://docs.virustotal.com/docs/false-positive)). Ngoài ra có VirusTotal Monitor, dịch vụ quét định kỳ cho "software developers" để bắt false positive sớm ([Software Publishers](https://docs.virustotal.com/reference/software-publishers)). Monitor cần tài khoản riêng, không thuộc public API.

## 3. GitHub Actions có sẵn

### crazy-max/ghaction-virustotal

Nguồn: [repo](https://github.com/crazy-max/ghaction-virustotal), đọc [`action.yml`](https://github.com/crazy-max/ghaction-virustotal/blob/936d8c5c00afe97d3d9a1af26d017cfdf26800a2/action.yml) và `src/*.ts` tại tag `v5.0.0`.

- Tình trạng: MIT, 232 sao, không archive. Bản mới nhất là `v5.0.0` (2026-03-03, chuyển sang `node24`). Commit cuối trên `master` ngày 2026-06-28. Còn 29 issue mở. ([releases](https://github.com/crazy-max/ghaction-virustotal/releases)) Tag `v5.0.0` và `v5` cùng trỏ tới commit `936d8c5c00afe97d3d9a1af26d017cfdf26800a2`.
- Cách hoạt động ([`src/virustotal.ts`](https://github.com/crazy-max/ghaction-virustotal/blob/936d8c5c00afe97d3d9a1af26d017cfdf26800a2/src/virustotal.ts)): file `< 32*1024*1024` byte thì gửi `POST /files`, lớn hơn thì lấy `/files/upload_url`. Toàn bộ file được đọc vào RAM (`readFileSync`). Link trả về có dạng `https://www.virustotal.com/gui/file-analysis/<analysis id>/detection`, tức trỏ tới một lần phân tích cụ thể, không phải link theo SHA-256. Các file được xử lý tuần tự ([`src/context.ts`](https://github.com/crazy-max/ghaction-virustotal/blob/936d8c5c00afe97d3d9a1af26d017cfdf26800a2/src/context.ts), `asyncForEach`). Có input `request_rate`, README khuyên "Set to `4` or lower when using the standard free public API".
- Thêm link vào Release: được, qua `update_release_body: true`. Nhưng tùy chọn này chỉ chạy khi workflow được kích hoạt bởi sự kiện `release` ([README](https://github.com/crazy-max/ghaction-virustotal#scan-assets-of-a-published-release)). Code lấy release bằng `getReleaseByTag` ([`src/main.ts`](https://github.com/crazy-max/ghaction-virustotal/blob/936d8c5c00afe97d3d9a1af26d017cfdf26800a2/src/main.ts), [`src/ghrelease.ts`](https://github.com/crazy-max/ghaction-virustotal/blob/936d8c5c00afe97d3d9a1af26d017cfdf26800a2/src/ghrelease.ts)). Muốn dùng thì phải có workflow thứ hai chạy `on: release: types: [published]`, nghĩa là link chỉ xuất hiện *sau* khi đã Publish. Với luồng của ta, cách này vẫn chạy được: Release nháp do `GITHUB_TOKEN` tạo không kích hoạt workflow, vì "events triggered by the `GITHUB_TOKEN` ... will not create a new workflow run" ([Triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)). Còn khi *bạn* bấm Publish thì sự kiện `published` vẫn kích hoạt ([Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), mục `release`).
- Các issue đáng biết:
  - [#220](https://github.com/crazy-max/ghaction-virustotal/issues/220) (mở): khi chạy lại job, VirusTotal trả `409 AlreadyExistsError` và action dừng luôn, không xử lý các file còn lại.
  - [#110](https://github.com/crazy-max/ghaction-virustotal/issues/110) (mở): đề xuất thêm input release ID để dùng được ngay trong workflow phát hành. Hiện chưa có.

### cssnr/virustotal-action

Nguồn: [repo](https://github.com/cssnr/virustotal-action), [`action.yml`](https://github.com/cssnr/virustotal-action/blob/5edfa4c982eb0caec6d568ea27cf715269f5c23b/action.yml), [`src/vt.js`](https://github.com/cssnr/virustotal-action/blob/5edfa4c982eb0caec6d568ea27cf715269f5c23b/src/vt.js).

- Tình trạng: GPL-3.0, 10 sao. Bản `v2.0.0` ra 2026-04-25, tag trỏ tới commit `5edfa4c982eb0caec6d568ea27cf715269f5c23b`. Lần push gần nhất 2026-06-04.
- Điểm hơn crazy-max: có input `release_id`, nên chạy được ngay trong workflow phát hành, kể cả trên Release nháp (lấy release theo ID qua `getRelease`). Có tùy chọn `update_release` (mặc định `true`) và `rate_limit` (mặc định `4`). Upload dạng stream, không đọc hết file vào RAM. Link trả về vẫn là dạng `gui/file-analysis/<id>`.
- Nhược điểm: ít người dùng hơn hẳn, do một người duy trì.

### Đánh giá độ tin cậy

- Cả hai action đều phải nhận `VT_API_KEY`, và khi sửa Release body thì phải được cấp `contents: write`. Một action bị chiếm quyền có thể sửa Release hoặc thay asset. GitHub khuyên: "Pin references to actions to a commit SHA in your workflow files ... When selecting a SHA, you should verify it is from the action's repository and not a repository fork." ([Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use))
- Nếu dùng action thì ghim SHA như sau: `crazy-max/ghaction-virustotal@936d8c5c00afe97d3d9a1af26d017cfdf26800a2 # v5.0.0` hoặc `cssnr/virustotal-action@5edfa4c982eb0caec6d568ea27cf715269f5c23b # v2.0.0`. Hai SHA này lấy từ `git/ref/tags/...` của chính repo gốc.
- Nhưng việc cần làm ở đây chỉ gồm 2–3 lệnh `curl`, và job `release` đã chạy trên `ubuntu-latest`, có sẵn `gh`, `jq`, `sha256sum`. Tự viết script thì không phải tin thêm một bên thứ ba nào đang giữ quyền ghi.

## 4. Chỗ đặt bước trong `desktop.yml`

Job `release` hiện có (`.github/workflows/desktop.yml`, dòng 103–122) gồm ba bước: tải artifact vào `out/`, tạo `SHA256SUMS.txt`, rồi `gh release create ... --draft --generate-notes`. Chỗ hợp lý để chen vào là **sau "Checksums" và trước "Draft the release"**:

- Bước VirusTotal đọc `SHA256SUMS.txt`. Với mỗi file `.exe/.dmg/.AppImage/.deb`, nó gọi `GET /files/<sha>`. Nếu nhận `404` thì lấy `upload_url` rồi upload, còn đã có thì bỏ qua (nhờ vậy tránh được lỗi 409 khi chạy lại job). Mỗi file ghi một dòng `- [name](https://www.virustotal.com/gui/file/<sha>/detection)` vào `vt.md`. Giữa các request ngủ khoảng 16 giây để không vượt 4 request/phút. 4 file mất khoảng 3–4 phút.
- Bước "Draft the release" truyền thêm `--notes "$(cat vt.md)"`. Theo `gh release create --help` (gh 2.103.3), "Additional release notes can be prepended to automatically generated notes by using the `--notes` flag".
- Đặt `continue-on-error: true` để VirusTotal lỗi hay hết quota thì Release nháp vẫn được tạo. Đặt `if: env.VT_API_KEY != ''`, với `VT_API_KEY: ${{ secrets.VT_API_KEY }}` khai báo ở mức job, để fork hoặc repo chưa có secret thì bỏ qua bước này.
- Không cần thêm quyền: job đã có `contents: write`. Key VirusTotal chỉ đi vào header `x-apikey` ([Authentication](https://docs.virustotal.com/reference/authentication)).

Phác thảo (chưa chạy thử, cần test bằng một tag thử):

```yaml
  release:
    # ...
    env:
      VT_API_KEY: ${{ secrets.VT_API_KEY }}
    steps:
      # ... download-artifact, Checksums ...
      - name: VirusTotal (upload installers, report links from SHA-256)
        if: env.VT_API_KEY != ''
        continue-on-error: true
        run: |
          cd out
          vt() { curl -s -H "x-apikey: $VT_API_KEY" "$@"; }
          { echo "### VirusTotal"; echo; } > ../vt.md
          while read -r sha name; do
            case "$name" in *.exe|*.dmg|*.AppImage|*.deb) ;; *) continue ;; esac
            if [ "$(vt -o /dev/null -w '%{http_code}' "https://www.virustotal.com/api/v3/files/$sha")" != 200 ]; then
              sleep 16; url=$(vt https://www.virustotal.com/api/v3/files/upload_url | jq -r .data)
              sleep 16; vt -f -F "file=@$name" "$url" > /dev/null
            fi
            echo "- [\`$name\`](https://www.virustotal.com/gui/file/$sha/detection)" >> ../vt.md
            sleep 16
          done < SHA256SUMS.txt
      - name: Draft the release
        # ... thêm: notes=(); [ -s vt.md ] && notes=(--notes "$(cat vt.md)")
        #     gh release create ... --generate-notes "${notes[@]}"
```

## 5. Cách làm tay

- Sau khi Release nháp xuất hiện: tải 4 bộ cài về (hoặc dùng bản build local), upload từng file qua giao diện web virustotal.com. VirusTotal ghi rằng "The web interface has the highest scanning priority among the publicly available submission methods" ([How it works](https://docs.virustotal.com/docs/how-it-works)). Upload xong thì copy link (hoặc tự dựng link từ `SHA256SUMS.txt` theo mục 2) và dán vào Release nháp trước khi Publish.
- Thời gian (ước lượng của tôi, không có nguồn): khoảng 0,8 GB cần tải xuống rồi upload lại. Với đường lên khoảng 20 Mbit/s thì riêng upload đã mất cỡ 5–6 phút, cộng thời gian chờ quét và sửa ghi chú. Tổng cộng khoảng 15–20 phút mỗi lần phát hành, và rất dễ quên.
- Làm tay chỉ có lợi ở chỗ không cần tạo API key và không phải lưu secret.

## 6. So sánh và khuyến nghị

| | Bước tự động trong `desktop.yml` (script `curl`) | Workflow `on: release published` + crazy-max | Làm tay |
|---|---|---|---|
| Thấy kết quả trước Publish | Có (link nằm sẵn trong Release nháp) | Không (link được thêm sau khi đã công khai) | Có, nếu không quên |
| Bên thứ ba có quyền ghi | Không | Có (cần ghim SHA) | Không |
| Chạy lại job | Bỏ qua file đã có, không bị 409 | Dừng vì 409 ([#220](https://github.com/crazy-max/ghaction-virustotal/issues/220)) | Không áp dụng |
| Công sức mỗi lần phát hành | 0, chỉ cần tạo secret một lần | 0 | Khoảng 15–20 phút (ước lượng) |
| Hợp điều khoản public API | Có: phi thương mại, đóng góp file mới, 12/500 request | Có | Có |

**Chọn bước tự động trong `desktop.yml`.** Lý do:

1. Nó khớp đúng luồng "kiểm Release nháp rồi mới Publish" ([ADR-012](../adr/ADR-012-distribution.md)). Nếu có engine báo nhầm, bạn thấy ngay trước khi bản phát hành ra ngoài.
2. Link dựng từ SHA-256, người dùng đối chiếu được với `SHA256SUMS.txt`.
3. Không phải tin thêm action bên thứ ba nào.
4. Lượng request nằm xa dưới quota miễn phí.

Việc cần làm: tạo tài khoản VirusTotal Community, đặt API key vào secret `VT_API_KEY` của repo, rồi thêm bước trên và thử bằng một tag thử. Nếu chưa muốn đụng vào CI, cách làm tay ở mục 5 dùng được ngay, chỉ cần thêm một dòng vào checklist phát hành.
