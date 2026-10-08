import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, type PDFObject } from 'pdf-lib';

const PT = 72;

/**
 * Sets exact page boxes on an interior PDF: MediaBox = BleedBox = trim + bleed, TrimBox = trim.
 * Chromium sizes pages in 1/300″ steps; interior sizes are exact multiples, but this also crops
 * any rounding from the top-left-anchored content.
 */
export async function finishInterior(bytes: Uint8Array, trim: { width: number; height: number }, bleed: number): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const w = (trim.width + 2 * bleed) * PT;
  const h = (trim.height + 2 * bleed) * PT;
  for (const page of doc.getPages()) {
    const actual = page.getMediaBox();
    if (actual.width + 0.01 < w || actual.height + 0.01 < h) throw new Error(`Rendered page ${actual.width}×${actual.height} pt is smaller than ${w}×${h} pt.`);
    const y = actual.y + actual.height - h; // content hangs from the top edge
    page.setMediaBox(actual.x, y, w, h);
    page.setBleedBox(actual.x, y, w, h);
    page.setTrimBox(actual.x + bleed * PT, y + bleed * PT, trim.width * PT, trim.height * PT);
  }
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

/** Crops the cover to Lulu's exact size. It's rendered on a slightly larger sheet (COVER_SHEET_PAD_IN); the excess is outside the bleed. */
export async function finishCover(bytes: Uint8Array, widthPt: number, heightPt: number): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const [page] = doc.getPages();
  if (!page || doc.getPageCount() !== 1) throw new Error(`A cover must be one page, got ${doc.getPageCount()}.`);
  const actual = page.getMediaBox();
  if (actual.width + 0.01 < widthPt || actual.height + 0.01 < heightPt) {
    throw new Error(`Rendered cover ${actual.width}×${actual.height} pt is smaller than ${widthPt}×${heightPt} pt.`);
  }
  const y = actual.y + actual.height - heightPt;
  page.setMediaBox(actual.x, y, widthPt, heightPt);
  page.setBleedBox(actual.x, y, widthPt, heightPt);
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

export interface PdfFont {
  name: string;
  subtype: string;
  embedded: boolean;
}

export interface PdfReport {
  pages: number;
  /** Distinct MediaBox sizes in points, rounded to 0.01. */
  mediaBoxes: string[];
  trimBoxes: string[];
  fonts: PdfFont[];
  /** Images or graphics states with soft masks: transparency Lulu wants flattened. */
  softMasks: number;
  /** Graphics states with fill or stroke alpha below 1. */
  alphaStates: number;
  annotations: number;
}

/** What Lulu's preflight cares about, read from the PDF's objects. Used by golden tests and sample reports. */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfReport> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const look = (o: PDFObject | undefined): PDFObject | undefined => (o instanceof PDFRef ? ctx.lookup(o) : o);
  const dictOf = (o: PDFObject | undefined): PDFDict | undefined => {
    const v = look(o);
    return v instanceof PDFDict ? v : v instanceof PDFStream || v instanceof PDFRawStream ? v.dict : undefined;
  };
  const name = (d: PDFDict, key: string) => {
    const v = look(d.get(PDFName.of(key)));
    return v instanceof PDFName ? v.decodeText() : undefined;
  };
  const num = (d: PDFDict, key: string) => {
    const v = look(d.get(PDFName.of(key)));
    return v instanceof PDFNumber ? v.asNumber() : undefined;
  };

  const fonts: PdfFont[] = [];
  let softMasks = 0;
  let alphaStates = 0;
  const check = (d: PDFDict) => {
    const type = name(d, 'Type');
    const subtype = name(d, 'Subtype');
    if (type === 'Font' && subtype !== 'CIDFontType0' && subtype !== 'CIDFontType2') {
      let descriptor = dictOf(d.get(PDFName.of('FontDescriptor')));
      if (subtype === 'Type0') {
        const desc = look(d.get(PDFName.of('DescendantFonts')));
        const cid = desc instanceof PDFArray ? dictOf(desc.get(0)) : undefined;
        descriptor = cid && dictOf(cid.get(PDFName.of('FontDescriptor')));
      }
      const embedded = subtype === 'Type3' || Boolean(descriptor && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => descriptor!.has(PDFName.of(k))));
      fonts.push({ name: name(d, 'BaseFont') ?? '(unnamed)', subtype: subtype ?? '?', embedded });
    }
    if (subtype === 'Image' && d.has(PDFName.of('SMask'))) softMasks++;
    if (type === 'ExtGState' || d.has(PDFName.of('ca')) || d.has(PDFName.of('CA'))) {
      const sm = look(d.get(PDFName.of('SMask')));
      if (sm && !(sm instanceof PDFName && sm.decodeText() === 'None')) softMasks++;
      const ca = num(d, 'ca');
      const CA = num(d, 'CA');
      if ((ca !== undefined && ca < 1) || (CA !== undefined && CA < 1)) alphaStates++;
    }
  };
  // Every dictionary in the file: indirect objects, and dictionaries nested inside them (resources
  // often hold graphics states and fonts inline). References are followed by the outer loop only.
  const visit = (o: PDFObject | undefined): void => {
    if (o instanceof PDFStream || o instanceof PDFRawStream) return visit(o.dict);
    if (o instanceof PDFDict) {
      check(o);
      for (const [, v] of o.entries()) if (!(v instanceof PDFRef)) visit(v);
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) if (!(v instanceof PDFRef)) visit(v);
    }
  };
  for (const [, obj] of ctx.enumerateIndirectObjects()) visit(obj);

  const fmt = (b: { width: number; height: number }) => `${b.width.toFixed(2)}x${b.height.toFixed(2)}`;
  const pages = doc.getPages();
  let annotations = 0;
  for (const p of pages) {
    const a = look(p.node.get(PDFName.of('Annots')));
    if (a instanceof PDFArray) annotations += a.size();
  }
  return {
    pages: pages.length,
    mediaBoxes: [...new Set(pages.map((p) => fmt(p.getMediaBox())))],
    trimBoxes: [...new Set(pages.map((p) => fmt(p.getTrimBox())))],
    fonts,
    softMasks,
    alphaStates,
    annotations,
  };
}
