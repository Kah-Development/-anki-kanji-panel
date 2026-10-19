/* Anki Kanji Panel — MIT. No jQuery or website scraping. */
(function (global) {
  'use strict';
  const defaults = {
    source: '#word', target: '#kanjiInfo', token: '', timeout: 10000,
    show: { radicals: true, meanings: true, onyomi: true, kunyomi: true, nanori: false,
      meaningMnemonic: true, readingMnemonic: true, level: true, source: true },
    theme: { fontSize: '16px', kanjiSize: '48px', text: 'inherit',
      background: 'transparent', accent: '#b647c9', border: '#88888866' }
  };
  function extract(text) {
    // Code-point iteration preserves supplementary-plane kanji. No punctuation/kana.
    let han;
    try { han = new RegExp('\\p{Unified_Ideograph}', 'u'); }
    catch (_) { han = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]|[\u{20000}-\u{323af}]/u; }
    return Array.from(new Set(Array.from(text).filter(c => han.test(c) || c === '〇' || c === '〆')));
  }
  async function json(url, options, timeout, fetcher, asText) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher(url, Object.assign({}, options, { signal: controller.signal }));
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return asText ? response.text() : response.json();
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new Error('Request timed out'));
        }, timeout); })
      ]);
    } finally { clearTimeout(timer); }
  }
  async function lookup(chars, config, fetcher) {
    const wk = new Map(); let wkError = '';
    if (config.token) {
      try {
        // Small chunks keep long sentences within practical URL limits.
        for (let i = 0; i < chars.length; i += 40) {
          let url = 'https://api.wanikani.com/v2/subjects?types=kanji&slugs=' + encodeURIComponent(chars.slice(i, i + 40).join(','));
          while (url) {
            if (new URL(url).origin !== 'https://api.wanikani.com') throw new Error('Unexpected API origin');
            const page = await json(url, { headers: { Authorization: 'Bearer ' + config.token,
              'Wanikani-Revision': '20170710' } }, config.timeout, fetcher);
            if (!Array.isArray(page.data)) throw new Error('Invalid WaniKani response');
            page.data.forEach(s => { if (s.object === 'kanji' && s.data) wk.set(s.data.characters, s.data); });
            url = page.pages && page.pages.next_url;
          }
        }
      } catch (e) { wkError = 'WaniKani unavailable (' + e.message + '); using kanjiapi.dev where needed.'; }
    }
    const results = new Array(chars.length); let cursor = 0;
    async function worker() {
      while (cursor < chars.length) {
        const index = cursor++; const char = chars[index]; const subject = wk.get(char);
        if (subject) { results[index] = { char, wk: subject }; continue; }
        try {
          const data = await json('https://kanjiapi.dev/v1/kanji/' + encodeURIComponent(char), {}, config.timeout, fetcher);
          if (data.kanji !== char || !Array.isArray(data.meanings)) throw new Error('Invalid dictionary response');
          results[index] = { char, api: data };
        } catch (e) { results[index] = { char, error: 'No data available (' + e.message + '). Check your connection or try again.' }; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, chars.length) }, worker));
    return { results, warning: wkError };
  }
  // KanjiVG component metadata: © Ulrich Apel, CC BY-SA 3.0.
  // https://kanjivg.tagaini.net/ — SVG is read as data, never inserted as HTML.
  function parseComponents(svg, char) {
    const stack = [], groups = [];
    const clean = svg.replace(/<!--[\s\S]*?-->/g, '');
    for (const match of clean.matchAll(/<\/?g\b[^>]*>/g)) {
      const tag = match[0];
      if (tag.startsWith('</')) { stack.pop(); continue; }
      const attr = name => (tag.match(new RegExp('\\bkvg:' + name + '="([^"<>]*)"')) || [])[1];
      const element = attr('element');
      const parent = [...stack].reverse().find(g => g.element);
      const group = { element, radical: attr('radical'), children: [] };
      if (parent && element) parent.children.push(group);
      groups.push(group);
      if (!tag.endsWith('/>')) stack.push(group);
    }
    const root = groups.find(g => g.element === char);
    if (!root) throw new Error('No component data');
    const descendants = [];
    function walk(g) { descendants.push(g); g.children.forEach(walk); }
    walk(root);
    const unique = values => [...new Set(values.filter(Boolean))];
    return {
      radicals: unique(descendants.filter(g => g.radical).map(g => g.element)),
      components: unique(descendants.filter(g => !g.children.length).map(g => g.element))
    };
  }
  async function addComponents(results, config, fetcher) {
    if (!config.show.radicals) return;
    let cursor = 0;
    async function worker() {
      while (cursor < results.length) {
        const result = results[cursor++];
        const code = result.char.codePointAt(0).toString(16).padStart(5, '0');
        try {
          const svg = await json('https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg@master/kanji/' + code + '.svg',
            {}, config.timeout, fetcher, true);
          result.parts = parseComponents(svg, result.char);
        } catch (_) { result.partsError = 'Component data unavailable.'; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, results.length) }, worker));
  }
  function node(doc, tag, text, className) {
    const el = doc.createElement(tag); if (text != null) el.textContent = text;
    if (className) el.className = className; return el;
  }
  function render(target, payload, config) {
    const doc = target.ownerDocument; target.replaceChildren();
    if (payload.warning) target.appendChild(node(doc, 'p', payload.warning, 'akp-status'));
    for (const result of payload.results) {
      const card = node(doc, 'section', null, 'akp-card'); card.lang = 'ja';
      card.appendChild(node(doc, 'div', result.char, 'akp-character'));
      function row(label, value) {
        if (!value || (Array.isArray(value) && !value.length)) return;
        const p = node(doc, 'p'); p.appendChild(node(doc, 'strong', label + ': '));
        p.appendChild(doc.createTextNode(Array.isArray(value) ? value.join(', ') : String(value))); card.appendChild(p);
      }
      if (config.show.radicals) {
        if (result.parts) {
          row('Radical', result.parts.radicals.length ? result.parts.radicals : 'Not listed');
          row('Components', result.parts.components);
          const credit = node(doc, 'a', 'KanjiVG · © Ulrich Apel · CC BY-SA 3.0', 'akp-status');
          credit.href = 'https://kanjivg.tagaini.net/';
          card.appendChild(credit);
        } else row('Radicals', result.partsError || 'Loading…');
      }
      const w = result.wk, a = result.api;
      if (result.error) row('Lookup', result.error);
      else {
        if (config.show.meanings) row('Meaning', w ? w.meanings.map(m => m.meaning) : a.meanings);
        for (const [option, type, label, field] of [
          ['onyomi', 'onyomi', 'On’yomi', 'on_readings'],
          ['kunyomi', 'kunyomi', 'Kun’yomi', 'kun_readings'],
          ['nanori', 'nanori', 'Name readings', 'name_readings']]) {
          if (config.show[option]) row(label, w ? w.readings.filter(r => r.type === type).map(r => r.reading) : a[field]);
        }
        // Convert API markup to plain text; never insert remote HTML into Anki.
        const plain = text => String(text || '').replace(/<[^>]*>/g, '');
        if (config.show.meaningMnemonic) row('Meaning mnemonic', w ? plain(w.meaning_mnemonic) : 'Not supplied by kanjiapi.dev.');
        if (config.show.readingMnemonic) row('Reading mnemonic', w ? plain(w.reading_mnemonic) : 'Not supplied by kanjiapi.dev.');
        if (config.show.level) row(w ? 'WaniKani level' : 'JLPT', w ? w.level : (a.jlpt ? 'N' + a.jlpt : null));
        if (config.show.source) row('Source', w ? 'WaniKani' : 'kanjiapi.dev / KANJIDIC2');
      }
      target.appendChild(card);
    }
  }
  async function mount(options) {
    const config = Object.assign({}, defaults, options);
    config.show = Object.assign({}, defaults.show, options && options.show);
    config.theme = Object.assign({}, defaults.theme, options && options.theme);
    const target = document.querySelector(config.target); if (!target) return;
    const run = {}; target._akpRun = run; target.classList.add('akp');
    Object.entries(config.theme).forEach(([key, value]) => target.style.setProperty('--akp-' + key, value));
    const source = document.querySelector(config.source);
    if (!source) { target.textContent = 'Kanji panel: source field not found (' + config.source + ').'; return; }
    const copy = source.cloneNode(true); copy.querySelectorAll('rt,rp,script,style').forEach(el => el.remove());
    const chars = extract(copy.textContent || '');
    target.textContent = chars.length ? 'Loading kanji…' : 'No kanji in this field.';
    if (!chars.length) return;
    try {
      const payload = await lookup(chars, config, global.fetch.bind(global));
      if (target.isConnected && target._akpRun === run) render(target, payload, config);
      await addComponents(payload.results, config, global.fetch.bind(global));
      // Anki reuses its webview: an old request must not overwrite a new card.
      if (target.isConnected && target._akpRun === run) render(target, payload, config);
    } catch (_) { if (target._akpRun === run) target.textContent = 'Kanji lookup failed. Flip the card again to retry.'; }
  }
  const api = { mount, extract, lookup, defaults, render, parseComponents, addComponents };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.AnkiKanjiPanel = api;
})(typeof window !== 'undefined' ? window : globalThis);
