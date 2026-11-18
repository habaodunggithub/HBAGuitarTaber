// Download links for the page, design-independent (docs/adr/ADR-012-distribution.md).
// Order of trust: latest.json (written by .github/workflows/pages.yml at deploy) -> GitHub REST API -> the Releases page.
// Markup contract:
//   [data-dl="win|mac|appimage|deb|sums"]  href (+ [data-size] inside: file size)
//   [data-primary]                         href + label for the visitor's OS ([data-primary-label] inside, if any)
//   [data-primary-note]                    the matching requirement
//   [data-version] [data-date]             release tag and date
//   <html data-release="ready|none|error"> and data-os="win|mac|linux|other" for CSS
// window.TaberDownload.render() re-labels and re-links in the page's current <html lang> (the EN/VI switch calls it).
(() => {
  const REPO = 'habaodunggithub/HBAGuitarTaber';
  const RELEASES = `https://github.com/${REPO}/releases`;
  const root = document.documentElement;
  const src = document.currentScript?.dataset.src || 'latest.json';

  const OS = (() => {
    const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '').toLowerCase();
    if (/android/.test(navigator.userAgent.toLowerCase())) return 'other';
    if (/win/.test(p)) return 'win';
    if (/mac|iphone|ipad/.test(p)) return 'mac';
    if (/linux|x11|cros/.test(p)) return 'linux';
    return 'other';
  })();
  root.dataset.os = OS;

  const LABEL = {
    en: {
      win: ['Download for Windows', 'Windows 10 or 11, 64-bit'],
      mac: ['Download for macOS', 'Apple Silicon, macOS 14 or newer'],
      linux: ['Download for Linux', 'AppImage, x86-64, glibc 2.35+'],
      other: ['All downloads', 'Windows, macOS and Linux'],
    },
    vi: {
      win: ['Tải cho Windows', 'Windows 10 hoặc 11, 64-bit'],
      mac: ['Tải cho macOS', 'Apple Silicon, macOS 14 trở lên'],
      linux: ['Tải cho Linux', 'AppImage, x86-64, glibc 2.35+'],
      other: ['Tất cả bản tải', 'Windows, macOS và Linux'],
    },
  };

  const kind = (name) =>
    /\.exe$/i.test(name) ? 'win'
      : /\.dmg$/i.test(name) ? 'mac'
        : /\.appimage$/i.test(name) ? 'appimage'
          : /\.deb$/i.test(name) ? 'deb'
            : /sha256sums/i.test(name) ? 'sums' : null;

  const mb = (n) => (n ? `${Math.round(n / 1048576)} MB` : '');
  let files = null;
  let release = null;

  function render() {
    links();
    const lang = root.lang === 'vi' ? 'vi' : 'en';
    const pick = files && { win: files.win, mac: files.mac, linux: files.appimage || files.deb }[OS];
    const key = pick ? OS : 'other';
    document.querySelectorAll('[data-primary]').forEach((el) => {
      el.href = pick ? pick.url : files ? '#systems' : RELEASES;
      (el.querySelector('[data-primary-label]') || el).textContent = LABEL[lang][key][0];
    });
    document.querySelectorAll('[data-primary-note]').forEach((el) => (el.textContent = LABEL[lang][key][1]));
    document.querySelectorAll('[data-date]').forEach((el) => {
      el.textContent = release?.published_at
        ? new Date(release.published_at).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : '';
    });
  }

  // links, sizes and version: run again after the language switch, which re-creates some links
  function links() {
    document.querySelectorAll('[data-dl]').forEach((el) => {
      const a = files?.[el.dataset.dl];
      el.href = a ? a.url : RELEASES;
      const size = el.querySelector('[data-size]');
      if (size) size.textContent = a ? mb(a.size) : '';
    });
    document.querySelectorAll('[data-version]').forEach((el) => (el.textContent = release?.tag || '–'));
  }

  function fill(rel) {
    release = rel;
    files = {};
    for (const a of rel.assets || []) {
      const k = kind(a.name);
      if (k && !files[k]) files[k] = a;
    }
    root.dataset.release = 'ready';
    render();
  }

  function none(state) {
    root.dataset.release = state;
    render();
  }

  async function fromApi() {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (r.status === 404) return { tag: null };
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    return { tag: j.tag_name, published_at: j.published_at, html_url: j.html_url,
      assets: j.assets.map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url })) };
  }

  window.TaberDownload = { render };

  (async () => {
    let rel = window.TABER_RELEASE || null; // design drafts embed preview data (file:// cannot fetch)
    if (!rel) {
      try {
        const r = await fetch(src, { cache: 'no-cache' });
        if (r.ok) rel = await r.json();
      } catch { /* fall through to the API */ }
    }
    if (!rel || (rel.tag && !rel.assets)) {
      try { rel = await fromApi(); } catch { rel = null; }
    }
    if (rel && rel.tag) fill(rel);
    else none(rel ? 'none' : 'error');
  })();
})();
