import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

let Parsers;

beforeAll(() => {
  // Load parsers.js as a script (not an ES module) so the self/window global
  // assignment runs in the jsdom environment, making Parsers available on globalThis.
  const code = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../lib/parsers.js'),
    'utf8'
  );
  // eslint-disable-next-line no-eval
  eval(code);
  Parsers = globalThis.Parsers;
});

describe('parseHTML', () => {
  it('returns null for falsy input', () => {
    expect(Parsers.parseHTML('')).toBeNull();
    expect(Parsers.parseHTML(null)).toBeNull();
    expect(Parsers.parseHTML(undefined)).toBeNull();
  });

  it('returns a Document for valid HTML', () => {
    const doc = Parsers.parseHTML('<p id="t">hello</p>');
    expect(doc).not.toBeNull();
    expect(doc.getElementById('t').textContent).toBe('hello');
  });
});

describe('parseHome', () => {
  it('returns empty array for null doc', () => {
    expect(Parsers.parseHome(null)).toEqual([]);
  });

  it('extracts comic entries from figure elements', () => {
    const doc = Parsers.parseHTML(`
      <figure>
        <a href="/123"><img data-src="http://pic.example.com/cover.jpg"></a>
        <figcaption>Test Comic</figcaption>
      </figure>
    `);
    const result = Parsers.parseHome(doc);
    expect(result).toHaveLength(1);
    expect(result[0].source_id).toBe('123');
    expect(result[0].title).toBe('Test Comic');
    expect(result[0].cover_url).toBe('http://pic.example.com/cover.jpg');
    expect(result[0].detail_url).toBe('https://51acgs.com/123');
  });

  it('deduplicates entries by source_id', () => {
    const doc = Parsers.parseHTML(`
      <figure><a href="/999"><img data-src="http://example.com/a.jpg"></a><figcaption>A</figcaption></figure>
      <figure><a href="/999"><img data-src="http://example.com/b.jpg"></a><figcaption>B</figcaption></figure>
    `);
    expect(Parsers.parseHome(doc)).toHaveLength(1);
  });

  it('skips figures without a numeric id in href', () => {
    const doc = Parsers.parseHTML(`
      <figure><a href="/about"><img data-src="http://example.com/a.jpg"></a></figure>
    `);
    expect(Parsers.parseHome(doc)).toHaveLength(0);
  });
});

describe('parseLDJson', () => {
  it('extracts Book and ItemList blocks', () => {
    const doc = Parsers.parseHTML(`
      <script type="application/ld+json">{"@type":"Book","author":{"name":"Test Author"},"genre":["Action"],"datePublished":"2024-01-15"}</script>
      <script type="application/ld+json">{"@type":"ItemList","name":"章节目录","numberOfItems":5}</script>
    `);
    const { book, itemLists } = Parsers.parseLDJson(doc);
    expect(book['@type']).toBe('Book');
    expect(book.datePublished).toBe('2024-01-15');
    expect(itemLists).toHaveLength(1);
    expect(itemLists[0].numberOfItems).toBe(5);
  });

  it('skips malformed JSON blocks silently', () => {
    const doc = Parsers.parseHTML(`
      <script type="application/ld+json">NOT JSON</script>
      <script type="application/ld+json">{"@type":"Book","author":"Solo"}</script>
    `);
    const { book } = Parsers.parseLDJson(doc);
    expect(book.author).toBe('Solo');
  });
});

describe('parseDetail', () => {
  it('returns null-filled object for null doc', () => {
    const r = Parsers.parseDetail(null);
    expect(r.author).toBeNull();
    expect(r.status).toBeNull();
    expect(r.tags).toBeNull();
  });

  it('extracts author from JSON-LD Book (object form)', () => {
    const doc = Parsers.parseHTML(`
      <script type="application/ld+json">{"@type":"Book","author":{"name":"Oda Eiichiro"}}</script>
    `);
    expect(Parsers.parseDetail(doc).author).toBe('Oda Eiichiro');
  });

  it('extracts author from JSON-LD Book (string form)', () => {
    const doc = Parsers.parseHTML(`
      <script type="application/ld+json">{"@type":"Book","author":"Toriyama"}</script>
    `);
    expect(Parsers.parseDetail(doc).author).toBe('Toriyama');
  });

  it('extracts chapter_count from ItemList', () => {
    const doc = Parsers.parseHTML(`
      <script type="application/ld+json">{"@type":"ItemList","name":"章节目录","numberOfItems":42}</script>
    `);
    expect(Parsers.parseDetail(doc).chapter_count).toBe(42);
  });

  it('extracts categories as comma-joined string', () => {
    const doc = Parsers.parseHTML(`
      <script type="application/ld+json">{"@type":"Book","genre":["Action","Fantasy"]}</script>
    `);
    expect(Parsers.parseDetail(doc).categories).toBe('Action,Fantasy');
  });
});

describe('parseChapters', () => {
  it('returns empty array for null doc', () => {
    expect(Parsers.parseChapters(null, '1')).toEqual([]);
  });

  it('parses chapters from LD+JSON ItemList', () => {
    const doc = Parsers.parseHTML(`
      <script type="application/ld+json">{"@type":"ItemList","name":"章节目录","itemListElement":[
        {"url":"https://51acgs.com/chapter/42","name":"Chapter 1"},
        {"url":"/chapter/43","name":"Chapter 2"}
      ]}</script>
    `);
    const result = Parsers.parseChapters(doc, '100');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ chapter_id: '42', comic_source_id: '100', chapter_name: 'Chapter 1' });
    expect(result[1].chapter_url).toBe('https://51acgs.com/chapter/43');
  });

  it('falls back to DOM links when no ItemList matches', () => {
    const doc = Parsers.parseHTML(`
      <a href="/chapter/7">Ch 7</a>
      <a href="/chapter/8">Ch 8</a>
    `);
    const result = Parsers.parseChapters(doc, '5');
    expect(result).toHaveLength(2);
    expect(result[0].chapter_id).toBe('7');
  });

  it('deduplicates chapter ids', () => {
    const doc = Parsers.parseHTML(`
      <a href="/chapter/99">Ch 99</a>
      <a href="/chapter/99">Ch 99 duplicate</a>
    `);
    expect(Parsers.parseChapters(doc, '1')).toHaveLength(1);
  });
});

describe('parseImages', () => {
  it('returns empty array for null doc', () => {
    expect(Parsers.parseImages(null)).toEqual([]);
  });

  it('extracts data-src from reader container images', () => {
    const doc = Parsers.parseHTML(`
      <div class="reader-container">
        <img data-src="http://pic.example.com/page1.jpg">
        <img data-src="http://pic.example.com/page2.jpg">
      </div>
    `);
    const urls = Parsers.parseImages(doc);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('page1');
  });

  it('filters out loading.png placeholder', () => {
    const doc = Parsers.parseHTML(`
      <div class="reader-container">
        <img data-src="http://pic.example.com/loading.png">
        <img data-src="http://pic.example.com/page1.jpg">
      </div>
    `);
    expect(Parsers.parseImages(doc)).toHaveLength(1);
  });

  it('only includes URLs containing "pic."', () => {
    const doc = Parsers.parseHTML(`
      <div class="reader-container">
        <img data-src="http://cdn.example.com/ad.jpg">
        <img data-src="http://pic.example.com/page1.jpg">
      </div>
    `);
    expect(Parsers.parseImages(doc)).toHaveLength(1);
  });
});
