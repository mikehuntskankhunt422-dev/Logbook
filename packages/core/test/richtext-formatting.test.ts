import { describe, expect, it } from 'vitest';
import { entryPlainText, fontFor, outputHeadingLevel, richTextToExportHtml, richTextToHtml, richTextToMarkdown, richTextToText, safeAlign, safeColor, type RichNode } from '../src/index.ts';

// The editor's formatting in exports and printed books (D91).

const t = (text: string, marks?: RichNode['marks']): RichNode => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...content: RichNode[]): RichNode => ({ type: 'paragraph', content });
const h = (level: number, text: string): RichNode => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const doc = (...content: RichNode[]): RichNode => ({ type: 'doc', content });
const task = (checked: boolean, text: string): RichNode => ({ type: 'taskItem', attrs: { checked }, content: [p(t(text))] });
const cell = (type: 'tableHeader' | 'tableCell', text: string, attrs?: Record<string, unknown>): RichNode => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null, ...attrs }, content: [p(t(text))] });
const table: RichNode = {
  type: 'table',
  content: [
    { type: 'tableRow', content: [cell('tableHeader', 'Day'), cell('tableHeader', 'Place')] },
    { type: 'tableRow', content: [cell('tableCell', 'Mon'), cell('tableCell', 'Rome | Italy')] },
  ],
};

describe('checked values', () => {
  it('only opaque hex colours, our fonts and known alignments', () => {
    expect(safeColor('#1A73E8')).toBe('#1a73e8');
    for (const bad of ['red', '#fff', '#11223344', 'rgba(0,0,0,.5)', '#1a73e8;background:url(x)', 7]) expect(safeColor(bad)).toBeUndefined();
    expect(fontFor('caveat')?.family).toBe('Caveat');
    expect(fontFor('Comic Sans; color:red')).toBeUndefined();
    expect(safeAlign('center')).toBe('center');
    expect(safeAlign('left')).toBeUndefined();
    expect(safeAlign('x" onload="')).toBeUndefined();
  });

  it('puts the biggest heading just below the entry title, keeping the old levels without an H1', () => {
    expect(outputHeadingLevel(h(2, 'x'), 1, false)).toBe(2);
    expect(outputHeadingLevel(h(3, 'x'), 1, false)).toBe(3);
    expect(outputHeadingLevel(h(1, 'x'), 1, true)).toBe(2);
    expect(outputHeadingLevel(h(2, 'x'), 1, true)).toBe(3);
    expect(outputHeadingLevel(h(6, 'x'), 2, true)).toBe(6);
  });
});

describe('Markdown and plain text', () => {
  const d = doc(
    h(1, 'Plans'),
    h(2, 'Packing'),
    { type: 'taskList', content: [task(true, 'Passport'), task(false, 'Sunscreen')] },
    table,
    { type: 'codeBlock', attrs: { language: null }, content: [t('let a = `b`;\n```')] },
    p(t('Remember the '), t('tickets', [{ type: 'highlight', attrs: { color: '#fff176' } }]), t(' and '), t('H', [{ type: 'code' }]), t('2', [{ type: 'subscript' }]), t('O')),
  );

  it('writes headings, task lists, tables, code and marks', () => {
    const md = richTextToMarkdown(d, 1);
    expect(md).toContain('## Plans\n\n### Packing');
    expect(md).toContain('- [x] Passport\n- [ ] Sunscreen');
    expect(md).toContain('| Day | Place |\n| --- | --- |\n| Mon | Rome \\| Italy |');
    expect(md).toContain('````\nlet a = `b`;\n```\n````');
    expect(md).toContain('Remember the <mark>tickets</mark> and `H`<sub>2</sub>O');
  });

  it('keeps plain text plain', () => {
    const text = richTextToText(d);
    expect(text).toContain('[x] Passport\n[ ] Sunscreen');
    expect(text).toContain('Day | Place\nMon | Rome | Italy');
    expect(text).toContain('Remember the tickets and H2O');
    expect(text).not.toContain('<');
  });

  it('finds the words for search', () => {
    const plain = entryPlainText({ blocks: [{ id: 'b', type: 'text', doc: d }] } as never);
    for (const w of ['Passport', 'Rome', 'tickets', 'let a']) expect(plain).toContain(w);
  });
});

describe('HTML (web page export and printed book)', () => {
  const d = doc(
    { type: 'paragraph', attrs: { textAlign: 'center' }, content: [t('Hi', [{ type: 'textStyle', attrs: { color: '#d93025', fontFamily: 'Caveat' } }])] },
    { type: 'taskList', content: [task(true, 'Done')] },
    table,
    p(t('x', [{ type: 'textStyle', attrs: { color: 'red;background:url(https://evil)', fontFamily: 'x}*{display:none' } }, { type: 'highlight', attrs: { color: 'rgba(0,0,0,0)' } }])),
  );

  it('the export shows checkboxes, tables, colours and fonts, and nothing unchecked', () => {
    const html = richTextToExportHtml(d);
    expect(html).toContain('<p style="text-align:center"><span style="color:#d93025;font-family:&#39;Twemoji Country Flags&#39;, &#39;Caveat&#39;, cursive">Hi</span></p>');
    expect(html).toContain('<input type="checkbox" disabled checked aria-label="Done">');
    expect(html).toContain('<th><p>Day</p></th>');
    expect(html).toContain('<td><p>Rome | Italy</p></td>');
    expect(html).toContain('<p><mark>x</mark></p>');
    expect(html).not.toMatch(/url\(|evil|display:none|rgba/);
  });

  it('the book draws boxes instead of inputs, and never links', () => {
    const html = richTextToHtml(d);
    expect(html).toContain('<li class="task done"><span class="box"></span><div><p>Done</p></div></li>');
    expect(html).toContain('<table><tbody><tr><th><p>Day</p></th>');
    expect(html).not.toMatch(/<input|<a\b|url\(|evil|rgba/);
  });

  it('keeps the old output for the old headings', () => {
    expect(richTextToHtml(doc(h(2, 'A'), h(3, 'B')))).toBe('<h3>A</h3><h4>B</h4>');
    expect(richTextToHtml(doc(h(1, 'A'), h(2, 'B'), h(6, 'C')))).toBe('<h3>A</h3><h4>B</h4><h6>C</h6>');
  });
});
