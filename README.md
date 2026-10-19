# Anki Kanji Panel

A dependency-free replacement for the WaniAnki card-template script. This is card-template JavaScript, not an installable Anki add-on.

## Install (recommended: synced media files)

1. Unzip the package. Copy `media/_kanji-panel.js` and `media/_kanji-panel.css` into Anki Desktop's `collection.media` folder (Tools → Check Media is not the folder; find your profile folder via Anki's documentation). Do not put them in a subfolder. On Windows this is normally `%APPDATA%/Anki2/<profile>/collection.media`; macOS `~/Library/Application Support/Anki2/<profile>/collection.media`; Linux `~/.local/share/Anki2/<profile>/collection.media`.
2. Open Browse → select a note → Cards. Back up your current card template. On the template side where you want the panel, keep the sentence/word element with `id="word"`. For example: `<div id="word">{{Sentence}}</div>` (replace Sentence with your actual field name). There must be only one `word` element and one `kanjiInfo` element on the rendered card; consider `{{FrontSide}}` if editing the back.
3. Remove the old WaniAnki script, jQuery link, stylesheet, and old `kanjiInfo` container. Paste the complete contents of `anki-snippet.html` in their place, after your sentence element.
4. Optional: put a NEW WaniKani API v2 token in the snippet's `token` setting. Leave blank for kanjiapi.dev alone. Never commit a real token or share a deck/template containing one. Revoke the previously disclosed token.
5. Sync notes and media on Desktop, then sync AnkiMobile/AnkiDroid and wait for media to finish. Test a card containing `猫、犬。猫と学校へ。`—expect 猫, 犬, 学, 校 in that order.

Underscore-prefixed media filenames keep template assets from normal unused-media cleanup. The JavaScript and CSS work without a remote script host, but dictionary lookups require Internet access. This has not been tested in an actual Anki client; client networking restrictions can vary. Errors are shown in the panel.

## Configure

Edit `config` in `anki-snippet.html`:

- `source`: CSS selector of the element holding the full sentence; default `#word`. Ruby pronunciation (`rt`, `rp`) is excluded.
- `token`: optional WaniKani v2 token. Used only for requests to api.wanikani.com; never sent to kanjiapi.dev.
- `show`: independent toggles for radicals, meanings, onyomi, kunyomi, nanori (name readings), meaningMnemonic, readingMnemonic, level, source.
- `theme`: `fontSize`, `kanjiSize`, `text`, `background`, `accent`, `border`; use CSS values such as `18px` or `#df85ee`. Inherited text and transparent backgrounds follow the card's light/dark theme. Explicit colors override that behavior.
- `timeout`: optional per-request limit in milliseconds, default 10000.

Radicals and component glyphs are fetched from KanjiVG without an API key. The Radical row follows KanjiVG’s dictionary classification; Components shows unique leaf shapes. These are structural components, not WaniKani’s named mnemonic radicals. Set `show.radicals` to false to disable the extra requests. Missing component data does not hide meanings or readings.

Stroke-order diagrams are intentionally absent. Kanjiapi.dev does not supply meaning/reading mnemonics or WaniKani radicals. Mnemonic fields show an availability message for fallback entries; turn their toggles off to hide them. WaniKani's supplied markup is reduced to plain text for safety.

## Lookup behavior and limits

Unicode ideographs are extracted from the entire source and deduplicated before requests, retaining first appearance. Kana, Latin text, `。`, `、`, and other punctuation are excluded. `々` is a repetition mark and is ignored; `〇` and `〆` are attempted as dictionary symbols. Supplementary-plane kanji are preserved.

WaniKani is queried in batches with pagination. Missing subjects, rejected tokens, and WaniKani/network errors fall back to kanjiapi.dev. Up to four dictionary requests run concurrently. Every extracted character retains a panel, even when neither provider returns data. This guarantees a visible result/error, not complete dictionary coverage or connectivity. Reading lists describe individual kanji; they do not determine the correct reading in a sentence. All fields within a kanji result use its selected provider; WK and fallback entries may list different readings.

No website scraping, public CORS proxy, jQuery, stroke sprites, or token persistence. No offline cache is included. Re-rendering a card performs fresh lookups. Stale requests cannot overwrite a later mount on the same target.

## GitHub setup

Repository: https://github.com/Kah-Development/-anki-kanji-panel. Download this repository as a ZIP using Code → Download ZIP, then follow the media installation instructions above. The repository itself contains no token. Use the media installation above; GitHub Pages is optional and not required. Do not point script tags at GitHub's HTML/raw views.

## Development

`npm test` (Node 18+); no npm dependencies required. After changing source, regenerate media copies with:

```
cp kanji-panel.js media/_kanji-panel.js
cp kanji-panel.css media/_kanji-panel.css
```

Automated tests cover extraction, ordered mixed results, failed authentication, no-token operation, timeouts, and pagination. Live kanjiapi.dev lookup for 猫 returned 200 and `Access-Control-Allow-Origin: *`. Actual Anki Desktop, AnkiMobile, and AnkiDroid verification remains to be performed.

## Data sources and attribution

- KanjiVG: https://kanjivg.tagaini.net/ — component metadata © Ulrich Apel, licensed under CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/). Component lists are extracted from the SVG group metadata; the SVG diagrams are not displayed. This data is separate from the MIT-licensed application code.

- WaniKani API: https://docs.api.wanikani.com/20170710/ — content remains subject to WaniKani/Tofugu terms. Mnemonics are fetched with the user's token, not distributed here.
- kanjiapi.dev: https://kanjiapi.dev/ — dictionary data from KANJIDIC2 / the Electronic Dictionary Research and Development Group. See https://www.edrdg.org/wiki/index.php/KANJIDIC_Project and https://www.edrdg.org/edrdg/licence.html for data attribution and licensing.
- Inspired by Damian's WaniAnki: https://damiansh.github.io/waniAnki/waniAnki.js . This implementation is written independently.

The MIT license below applies to this project's code, not third-party dictionary data or mnemonics.
