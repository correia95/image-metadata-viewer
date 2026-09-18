# Image Metadata Viewer

File info and EXIF metadata for a photo, entirely in the browser. React + TypeScript + Vite,
deployed as a static Cloudflare Worker.

- Drag-and-drop or file picker upload
- File info: name, type, size, dimensions, last modified
- JPEG EXIF: camera make/model, date taken, exposure time, aperture, ISO, focal length,
  orientation, software, GPS coordinates (with a map link)
- Hand-rolled EXIF/TIFF parser (no third-party library) — see `src/exif.ts`
- Nothing is uploaded — the file is read locally with the File API

## Dev

```
npm install
npm run dev
npm run build
npm run deploy
```
