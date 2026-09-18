import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExif, findExifSegment, readableSize } from './exif.ts';

// Hand-builds a minimal JPEG with a synthetic EXIF (APP1) segment containing
// a Make string and an Orientation short, little-endian ("II") byte order.
// This is the only reliable way to test a byte-level parser without a real
// camera photo checked into the repo.
function buildTestJpeg() {
  const makeStr = 'Canon\0'; // 6 bytes, ASCII count includes the trailing NUL
  const valueAreaOffset = 38; // right after IFD0 (8 header + 2 count + 2*12 entries + 4 next-ifd)

  const tiff = new Uint8Array(valueAreaOffset + makeStr.length);
  const dv = new DataView(tiff.buffer);
  tiff[0] = 0x49; tiff[1] = 0x49; // "II" little-endian
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true); // IFD0 offset
  dv.setUint16(8, 2, true); // 2 entries

  // Entry 1: Make (tag 0x010F), ASCII (type 2), count 6, offset -> valueAreaOffset
  dv.setUint16(10, 0x010f, true);
  dv.setUint16(12, 2, true);
  dv.setUint32(14, makeStr.length, true);
  dv.setUint32(18, valueAreaOffset, true);

  // Entry 2: Orientation (tag 0x0112), SHORT (type 3), count 1, value inline = 1
  dv.setUint16(22, 0x0112, true);
  dv.setUint16(24, 3, true);
  dv.setUint32(26, 1, true);
  dv.setUint16(30, 1, true);

  dv.setUint32(34, 0, true); // no next IFD

  for (let i = 0; i < makeStr.length; i++) tiff[valueAreaOffset + i] = makeStr.charCodeAt(i);

  const exifHeader = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  const app1Body = new Uint8Array(exifHeader.length + tiff.length);
  app1Body.set(exifHeader, 0);
  app1Body.set(tiff, exifHeader.length);

  const app1SegLen = app1Body.length + 2; // segment length field includes itself
  const jpeg = new Uint8Array(2 + 2 + 2 + app1Body.length + 2);
  const jdv = new DataView(jpeg.buffer);
  jdv.setUint16(0, 0xffd8); // SOI
  jdv.setUint16(2, 0xffe1); // APP1
  jdv.setUint16(4, app1SegLen);
  jpeg.set(app1Body, 6);
  jdv.setUint16(6 + app1Body.length, 0xffd9); // EOI

  return jpeg.buffer;
}

test('findExifSegment locates the TIFF header inside a JPEG APP1 segment', () => {
  const buf = buildTestJpeg();
  const offset = findExifSegment(buf);
  assert.equal(offset, 12); // 2 (SOI) + 2 (APP1 marker) + 2 (length field) + 6 ("Exif\0\0")
});

test('findExifSegment returns null for a non-JPEG buffer', () => {
  const buf = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer; // PNG signature
  assert.equal(findExifSegment(buf), null);
});

test('parseExif reads Make and Orientation from a synthetic little-endian EXIF block', () => {
  const buf = buildTestJpeg();
  const exif = parseExif(buf);
  assert.ok(exif, 'exif data should be found');
  assert.equal(exif.make, 'Canon');
  assert.equal(exif.orientation, 1);
});

test('parseExif returns null when there is no EXIF segment', () => {
  const plainJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer;
  assert.equal(parseExif(plainJpeg), null);
});

test('readableSize formats bytes, KB and MB', () => {
  assert.equal(readableSize(500), '500 B');
  assert.equal(readableSize(2048), '2.0 KB');
  assert.equal(readableSize(5 * 1024 * 1024), '5.00 MB');
});
