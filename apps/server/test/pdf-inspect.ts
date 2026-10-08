import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFStream, type PDFObject } from 'pdf-lib';

export interface PdfReport {
  pages: { widthPt: number; heightPt: number; trim: { x: number; y: number; width: number; height: number } }[];
  /** Subtype of every font dictionary (Type0, CIDFontType2, TrueType, Type3, …). */
  fontSubtypes: string[];
  /** BaseFont names, subset prefixes removed. */
  fontNames: string[];
  /** Font descriptors without an embedded font program. */
  unembeddedFonts: string[];
  /** Signs of live transparency, which Lulu requires flattened. */
  transparency: { softMasks: number; groups: number; alpha: number; blendModes: number };
  imageColorSpaces: string[];
  /** Raw DCTDecode (JPEG) image streams, for pixel checks. */
  jpegs: Uint8Array[];
}

const N = (s: string) => PDFName.of(s);

/** Structural facts about a PDF that Lulu cares about, read with pdf-lib. */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfReport> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const report: PdfReport = {
    pages: doc.getPages().map((p) => {
      const m = p.getMediaBox();
      return { widthPt: round2(m.width), heightPt: round2(m.height), trim: mapBox(p.getTrimBox()) };
    }),
    fontSubtypes: [],
    fontNames: [],
    unembeddedFonts: [],
    transparency: { softMasks: 0, groups: 0, alpha: 0, blendModes: 0 },
    imageColorSpaces: [],
    jpegs: [],
  };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
    if (!dict) continue;
    const type = dict.get(N('Type'));
    const subtype = dict.get(N('Subtype'));
    if (type === N('Font')) {
      report.fontSubtypes.push(name(subtype));
      const base = dict.get(N('BaseFont'));
      if (base) report.fontNames.push(name(base).replace(/^[A-Z]{6}\+/, ''));
    }
    if (type === N('FontDescriptor') && !['FontFile', 'FontFile2', 'FontFile3'].some((k) => dict.has(N(k)))) {
      report.unembeddedFonts.push(name(dict.get(N('FontName'))));
    }
    if (subtype === N('Image')) {
      report.imageColorSpaces.push(name(deref(doc, dict.get(N('ColorSpace')))));
      if (obj instanceof PDFRawStream && name(dict.get(N('Filter'))) === 'DCTDecode') report.jpegs.push(obj.contents);
      if (dict.has(N('SMask')) || dict.has(N('Mask'))) report.transparency.softMasks++;
    }
    if (type === N('ExtGState')) {
      const smask = dict.get(N('SMask'));
      if (smask && smask !== N('None')) report.transparency.softMasks++;
      for (const k of ['CA', 'ca']) {
        const v = deref(doc, dict.get(N(k)));
        if (v instanceof PDFNumber && v.asNumber() < 1) report.transparency.alpha++;
      }
      const bm = dict.get(N('BM'));
      if (bm && bm !== N('Normal') && bm !== N('Compatible')) report.transparency.blendModes++;
    }
    const group = deref(doc, dict.get(N('Group')));
    if (group instanceof PDFDict && group.get(N('S')) === N('Transparency')) report.transparency.groups++;
  }
  return report;
}

function deref(doc: PDFDocument, o: PDFObject | undefined): PDFObject | undefined {
  return o ? doc.context.lookup(o) : undefined;
}

function name(o: PDFObject | undefined): string {
  if (!o) return '';
  if (o instanceof PDFArray) return name(o.get(0));
  return o.toString().replace(/^\//, '');
}

function mapBox(b: { x: number; y: number; width: number; height: number }) {
  return { x: round2(b.x), y: round2(b.y), width: round2(b.width), height: round2(b.height) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
