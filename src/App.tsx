import { useCallback, useState } from 'react';
import { parseExif, readableSize, type ExifData } from './exif';

interface FileInfo {
  name: string;
  type: string;
  size: number;
  lastModified: number;
  width: number;
  height: number;
}

export default function App() {
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [exif, setExif] = useState<ExifData | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const loadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('That is not an image file.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('That image is over 50 MB — try a smaller file.');
      return;
    }
    setError('');
    const url = URL.createObjectURL(file);
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = url;
    });
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return url;
    });
    setInfo({
      name: file.name,
      type: file.type || 'unknown',
      size: file.size,
      lastModified: file.lastModified,
      width: dims.w,
      height: dims.h,
    });
    if (file.type === 'image/jpeg') {
      try {
        const buf = await file.arrayBuffer();
        setExif(parseExif(buf));
      } catch {
        setExif(null);
      }
    } else {
      setExif(null);
    }
  }, []);

  function reset() {
    setInfo(null);
    setExif(null);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setError('');
  }

  const orientationLabel: Record<number, string> = {
    1: 'Normal', 2: 'Flipped horizontally', 3: 'Rotated 180°', 4: 'Flipped vertically',
    5: 'Rotated 90° CW, flipped', 6: 'Rotated 90° CW', 7: 'Rotated 90° CCW, flipped', 8: 'Rotated 90° CCW',
  };

  return (
    <div className="page">
      <h1>Image Metadata Viewer</h1>
      <p className="lede">
        See a photo's file info and, for JPEGs, its EXIF data — camera, date taken, exposure and
        GPS location if present. The file is read directly in your browser and never uploaded.
      </p>

      {!info && (
        <div
          className={`drop${dragOver ? ' over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) loadFile(file);
          }}
        >
          <p>Drag an image here, or</p>
          <label className="filebtn">
            Choose an image
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) loadFile(file);
              }}
            />
          </label>
          {error && <p className="err">{error}</p>}
        </div>
      )}

      {info && (
        <>
          <div className="preview-row">
            {previewUrl && <img src={previewUrl} alt="" className="preview" />}
            <button className="ghost" onClick={reset}>Choose a different image</button>
          </div>

          <div className="panel">
            <h2>File info</h2>
            <dl className="kv">
              <dt>Name</dt><dd>{info.name}</dd>
              <dt>Type</dt><dd>{info.type}</dd>
              <dt>Size</dt><dd>{readableSize(info.size)} ({info.size.toLocaleString()} bytes)</dd>
              <dt>Dimensions</dt><dd>{info.width && info.height ? `${info.width} × ${info.height}px` : 'Unknown'}</dd>
              <dt>Last modified</dt><dd>{new Date(info.lastModified).toLocaleString()}</dd>
            </dl>
          </div>

          {info.type === 'image/jpeg' && (
            <div className="panel">
              <h2>EXIF data</h2>
              {exif && Object.keys(exif).length > 0 ? (
                <dl className="kv">
                  {exif.make && <><dt>Camera make</dt><dd>{exif.make}</dd></>}
                  {exif.model && <><dt>Camera model</dt><dd>{exif.model}</dd></>}
                  {exif.dateTimeOriginal && <><dt>Date taken</dt><dd>{exif.dateTimeOriginal}</dd></>}
                  {exif.exposureTime && <><dt>Exposure time</dt><dd>{exif.exposureTime}</dd></>}
                  {exif.fNumber && <><dt>Aperture</dt><dd>{exif.fNumber}</dd></>}
                  {exif.iso !== undefined && <><dt>ISO</dt><dd>{exif.iso}</dd></>}
                  {exif.focalLength && <><dt>Focal length</dt><dd>{exif.focalLength}</dd></>}
                  {exif.orientation !== undefined && <><dt>Orientation</dt><dd>{orientationLabel[exif.orientation] ?? exif.orientation}</dd></>}
                  {exif.software && <><dt>Software</dt><dd>{exif.software}</dd></>}
                  {exif.gpsLat !== undefined && exif.gpsLon !== undefined && (
                    <>
                      <dt>GPS location</dt>
                      <dd>
                        {exif.gpsLat.toFixed(5)}, {exif.gpsLon.toFixed(5)}{' '}
                        <a
                          href={`https://www.openstreetmap.org/?mlat=${exif.gpsLat}&mlon=${exif.gpsLon}#map=15/${exif.gpsLat}/${exif.gpsLon}`}
                          target="_blank" rel="noreferrer"
                        >
                          view map
                        </a>
                      </dd>
                    </>
                  )}
                </dl>
              ) : (
                <p className="hint">No EXIF data found in this file — it may have been stripped by an app or messaging service.</p>
              )}
            </div>
          )}
          {info.type !== 'image/jpeg' && (
            <p className="hint">EXIF data is only stored in JPEG files — {info.type.replace('image/', '').toUpperCase()} doesn't carry camera metadata the same way.</p>
          )}
        </>
      )}

      <section className="explainer">
        <h2>What is EXIF data?</h2>
        <p>
          EXIF (Exchangeable Image File Format) is metadata that cameras and phones embed in JPEG
          photos: the make and model of the camera, the date and time the photo was taken, exposure
          settings, and sometimes the GPS coordinates of where it was taken.
        </p>
        <h3>Does this upload my photo anywhere?</h3>
        <p>
          No. The file is read directly in your browser using the File API, and the EXIF data is
          parsed locally — nothing is sent to a server.
        </p>
        <h3>Why is there no EXIF data on my photo?</h3>
        <p>
          Many messaging apps, social networks and screenshot tools strip EXIF data (partly for
          privacy, since it can include your location). PNG, WebP and GIF files also don't use the
          EXIF format the way JPEGs do.
        </p>
      </section>
    </div>
  );
}
