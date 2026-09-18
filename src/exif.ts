// Minimal EXIF/TIFF reader for JPEG files — enough to surface the fields
// people actually look for (camera, date taken, exposure, GPS), without a
// third-party library. Not a full EXIF implementation.

export interface ExifData {
  make?: string;
  model?: string;
  dateTimeOriginal?: string;
  orientation?: number;
  exposureTime?: string;
  fNumber?: string;
  iso?: number;
  focalLength?: string;
  gpsLat?: number;
  gpsLon?: number;
  software?: string;
}

const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_ORIENTATION = 0x0112;
const TAG_SOFTWARE = 0x0131;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_EXPOSURE_TIME = 0x829a;
const TAG_FNUMBER = 0x829d;
const TAG_ISO = 0x8827;
const TAG_FOCAL_LENGTH = 0x920a;
const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_GPS_IFD_POINTER = 0x8825;
const TAG_GPS_LAT_REF = 1;
const TAG_GPS_LAT = 2;
const TAG_GPS_LON_REF = 3;
const TAG_GPS_LON = 4;

type TypeSize = Record<number, number>;
const TYPE_SIZES: TypeSize = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

class Reader {
  view: DataView;
  littleEndian: boolean;

  constructor(view: DataView, littleEndian: boolean) {
    this.view = view;
    this.littleEndian = littleEndian;
  }

  u16(offset: number): number {
    return this.view.getUint16(offset, this.littleEndian);
  }
  u32(offset: number): number {
    return this.view.getUint32(offset, this.littleEndian);
  }
  i32(offset: number): number {
    return this.view.getInt32(offset, this.littleEndian);
  }
}

function readIfd(r: Reader, tiffStart: number, ifdOffset: number): Map<number, { type: number; count: number; valueOffset: number }> {
  const entries = new Map<number, { type: number; count: number; valueOffset: number }>();
  const count = r.u16(tiffStart + ifdOffset);
  for (let i = 0; i < count; i++) {
    const entryOffset = tiffStart + ifdOffset + 2 + i * 12;
    const tag = r.u16(entryOffset);
    const type = r.u16(entryOffset + 2);
    const numValues = r.u32(entryOffset + 4);
    entries.set(tag, { type, count: numValues, valueOffset: entryOffset + 8 });
  }
  return entries;
}

function entryAbsoluteOffset(r: Reader, tiffStart: number, entry: { type: number; count: number; valueOffset: number }): number {
  const size = (TYPE_SIZES[entry.type] ?? 1) * entry.count;
  return size > 4 ? tiffStart + r.u32(entry.valueOffset) : entry.valueOffset;
}

function readAscii(r: Reader, tiffStart: number, entry: { type: number; count: number; valueOffset: number }): string {
  const offset = entryAbsoluteOffset(r, tiffStart, entry);
  let s = '';
  for (let i = 0; i < entry.count - 1; i++) {
    const c = r.view.getUint8(offset + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function readRational(r: Reader, tiffStart: number, entry: { type: number; count: number; valueOffset: number }, index = 0): number {
  const offset = entryAbsoluteOffset(r, tiffStart, entry) + index * 8;
  const num = r.u32(offset);
  const den = r.u32(offset + 4);
  return den === 0 ? 0 : num / den;
}

function readShort(r: Reader, entry: { type: number; count: number; valueOffset: number }): number {
  return r.u16(entry.valueOffset);
}

function formatExposure(seconds: number): string {
  if (seconds >= 1) return `${seconds}s`;
  const denom = Math.round(1 / seconds);
  return `1/${denom}s`;
}

function dms(r: Reader, tiffStart: number, entry: { type: number; count: number; valueOffset: number }): number {
  const d = readRational(r, tiffStart, entry, 0);
  const m = readRational(r, tiffStart, entry, 1);
  const s = readRational(r, tiffStart, entry, 2);
  return d + m / 60 + s / 3600;
}

// Finds the APP1 "Exif\0\0" segment in a JPEG and returns its byte offset
// (the start of the TIFF header), or null if there isn't one.
export function findExifSegment(buf: ArrayBuffer): number | null {
  const view = new DataView(buf);
  if (view.getUint16(0) !== 0xffd8) return null; // not a JPEG
  let offset = 2;
  while (offset < view.byteLength - 4) {
    const marker = view.getUint16(offset);
    if (marker === 0xffd9 || (marker & 0xff00) !== 0xff00) break;
    const segLen = view.getUint16(offset + 2);
    if (marker === 0xffe1) {
      const tag = String.fromCharCode(
        view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7),
      );
      if (tag === 'Exif') return offset + 10;
    }
    if (marker === 0xffda) break; // start of scan — no more metadata markers follow
    offset += 2 + segLen;
  }
  return null;
}

export function parseExif(buf: ArrayBuffer): ExifData | null {
  const tiffStart = findExifSegment(buf);
  if (tiffStart === null) return null;
  const view = new DataView(buf);
  const byteOrder = view.getUint16(tiffStart);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;
  const littleEndian = byteOrder === 0x4949;
  const r = new Reader(view, littleEndian);
  const ifd0Offset = r.u32(tiffStart + 4);
  const ifd0 = readIfd(r, tiffStart, ifd0Offset);

  const result: ExifData = {};
  if (ifd0.has(TAG_MAKE)) result.make = readAscii(r, tiffStart, ifd0.get(TAG_MAKE)!).trim();
  if (ifd0.has(TAG_MODEL)) result.model = readAscii(r, tiffStart, ifd0.get(TAG_MODEL)!).trim();
  if (ifd0.has(TAG_ORIENTATION)) result.orientation = readShort(r, ifd0.get(TAG_ORIENTATION)!);
  if (ifd0.has(TAG_SOFTWARE)) result.software = readAscii(r, tiffStart, ifd0.get(TAG_SOFTWARE)!).trim();

  if (ifd0.has(TAG_EXIF_IFD_POINTER)) {
    const exifOffset = r.u32(ifd0.get(TAG_EXIF_IFD_POINTER)!.valueOffset);
    const exifIfd = readIfd(r, tiffStart, exifOffset);
    if (exifIfd.has(TAG_DATETIME_ORIGINAL)) result.dateTimeOriginal = readAscii(r, tiffStart, exifIfd.get(TAG_DATETIME_ORIGINAL)!).trim();
    if (exifIfd.has(TAG_EXPOSURE_TIME)) result.exposureTime = formatExposure(readRational(r, tiffStart, exifIfd.get(TAG_EXPOSURE_TIME)!));
    if (exifIfd.has(TAG_FNUMBER)) result.fNumber = `f/${readRational(r, tiffStart, exifIfd.get(TAG_FNUMBER)!).toFixed(1)}`;
    if (exifIfd.has(TAG_ISO)) result.iso = readShort(r, exifIfd.get(TAG_ISO)!);
    if (exifIfd.has(TAG_FOCAL_LENGTH)) result.focalLength = `${readRational(r, tiffStart, exifIfd.get(TAG_FOCAL_LENGTH)!).toFixed(0)}mm`;
  }

  if (ifd0.has(TAG_GPS_IFD_POINTER)) {
    const gpsOffset = r.u32(ifd0.get(TAG_GPS_IFD_POINTER)!.valueOffset);
    const gpsIfd = readIfd(r, tiffStart, gpsOffset);
    if (gpsIfd.has(TAG_GPS_LAT) && gpsIfd.has(TAG_GPS_LAT_REF)) {
      const ref = readAscii(r, tiffStart, { ...gpsIfd.get(TAG_GPS_LAT_REF)!, count: 2 });
      const lat = dms(r, tiffStart, gpsIfd.get(TAG_GPS_LAT)!);
      result.gpsLat = ref === 'S' ? -lat : lat;
    }
    if (gpsIfd.has(TAG_GPS_LON) && gpsIfd.has(TAG_GPS_LON_REF)) {
      const ref = readAscii(r, tiffStart, { ...gpsIfd.get(TAG_GPS_LON_REF)!, count: 2 });
      const lon = dms(r, tiffStart, gpsIfd.get(TAG_GPS_LON)!);
      result.gpsLon = ref === 'W' ? -lon : lon;
    }
  }

  return result;
}

export function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
