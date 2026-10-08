import { PDFDocument } from 'pdf-lib';
import { PT_PER_IN } from '@logbook/core';

/**
 * Sets every page's boxes to exact sizes. Chromium snaps page sizes to a 1/300″ grid, so the PDF is
 * cropped to `widthIn × heightIn` from the top-left corner (where the layout is anchored). TrimBox
 * marks the finished size inside the bleed; BleedBox equals the MediaBox.
 */
export async function setPageBoxes(pdf: Uint8Array, box: { widthIn: number; heightIn: number; bleedIn: number }): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const w = box.widthIn * PT_PER_IN;
  const h = box.heightIn * PT_PER_IN;
  const b = box.bleedIn * PT_PER_IN;
  for (const page of doc.getPages()) {
    const media = page.getMediaBox();
    const top = media.y + media.height;
    if (media.width + 0.01 < w || media.height + 0.01 < h) {
      throw new RangeError(`PDF page is ${media.width}×${media.height} pt, smaller than the required ${w}×${h} pt`);
    }
    // Move the kept area to the origin: some preflight tools dislike boxes that don't start at 0,0.
    const dx = -media.x;
    const dy = -(top - h);
    if (dx || dy) page.translateContent(dx, dy);
    page.setMediaBox(0, 0, w, h);
    page.setCropBox(0, 0, w, h);
    page.setBleedBox(0, 0, w, h);
    page.setTrimBox(b, b, w - 2 * b, h - 2 * b);
  }
  // Keep the document as Chromium wrote it apart from the boxes: no object streams, no new metadata.
  return Buffer.from(await doc.save({ useObjectStreams: false, updateFieldAppearances: false }));
}
