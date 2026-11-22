// Renders the state the main process sends (src/main.ts SetupState) and sends the user's choice back.
(() => {
  const $ = (id) => document.getElementById(id);
  // the shell's catalog for this page (src/i18n.ts, setup); the English in setup.html is only what shows without it
  const strings = (window.taber && window.taber.strings) || {};
  const say = (key, values) => (strings[key] || key).replace(/\{(\w+)\}/g, (m, k) => (values && k in values ? values[k] : m));
  document.documentElement.lang = (window.taber && window.taber.lang) || 'en';
  for (const e of document.querySelectorAll('[data-t]')) if (strings[e.dataset.t]) e.textContent = strings[e.dataset.t];
  for (const e of document.querySelectorAll('[data-t-label]')) if (strings[e.dataset.tLabel]) e.setAttribute('aria-label', strings[e.dataset.tLabel]);
  const screens = ['boot', 'choose', 'installing', 'starting', 'error'];
  let timer = null;
  let rendered = '';

  function show(name) {
    for (const s of screens) $(s).hidden = s !== name;
  }

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v;
      else e.setAttribute(k, v);
    }
    for (const c of children) if (c != null) e.append(c);
    return e;
  }

  function renderChoose(s) {
    $('installDir').textContent = s.installDir;
    const key = JSON.stringify(s.variants) + s.recommended;
    if (rendered !== key) {
      rendered = key;
      const form = $('variants');
      form.replaceChildren(
        ...s.variants.map((v) => {
          const input = el('input', { type: 'radio', name: 'variant', value: v.id });
          if (v.id === (s.current || s.recommended)) input.checked = true;
          const title = el('b', {}, v.title, v.id === s.recommended ? el('span', { class: 'pick' }, say('picked')) : null);
          return el('label', { class: 'variant' },
            input, title, el('span', { class: 'size' }, v.size),
            el('p', {}, v.detail),
            v.warning ? el('span', { class: 'warn' }, v.warning) : null);
        }),
      );
    }
    const keep = $('keep');
    keep.hidden = !s.current;
    if (s.current) keep.textContent = say('keep', { variant: s.current });
    keep.onclick = () => window.taber.install(s.current);
    $('install').onclick = () => {
      const v = new FormData($('variants')).get('variant');
      if (v) {
        $('install').disabled = true;
        window.taber.install(String(v));
      }
    };
    $('install').disabled = false;
    // Windows / Linux have no menu bar: the engine commands sit behind the engine light in the app's top bar
    $('changeLater').textContent = say(/Mac/.test(navigator.platform) ? 'changeLaterMenu' : 'changeLaterLight');
  }

  function renderInstalling(s) {
    $('phase').textContent = s.phase;
    $('written').textContent = s.written || '–';
    $('writtenLabel').textContent = say(s.fraction !== undefined ? 'downloaded' : 'onDisk');
    $('rate').textContent = s.rate || '–';
    const bar = $('bar');
    bar.hidden = s.fraction === undefined;
    if (s.fraction !== undefined) {
      const pct = Math.round(s.fraction * 100);
      bar.setAttribute('aria-valuenow', String(pct));
      $('barFill').style.transform = `scaleX(${Math.max(s.fraction, 0.01)})`;
    }
    if (s.message) $('message').textContent = s.message;
    clearInterval(timer);
    const tick = () => {
      const t = Math.max(0, Math.round((Date.now() - s.startedAt) / 1000));
      $('elapsed').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  function render(s) {
    if (s.screen !== 'installing') clearInterval(timer);
    show(s.screen);
    if (s.screen === 'choose') renderChoose(s);
    else if (s.screen === 'installing') renderInstalling(s);
    else if (s.screen === 'starting') $('startMessage').textContent = `${s.message.toLowerCase()}…`;
    else if (s.screen === 'error') {
      $('errTitle').textContent = s.title;
      $('errMessage').textContent = s.message;
      $('errTail').textContent = s.logTail || say('emptyLog');
      $('errLog').textContent = s.logPath;
    }
  }

  $('retry').onclick = () => window.taber.retry();
  $('change').onclick = () => window.taber.change();
  $('logs').onclick = () => window.taber.openLogs();
  $('quit').onclick = () => window.taber.quit();
  if (window.taber) window.taber.onState(render);
})();
