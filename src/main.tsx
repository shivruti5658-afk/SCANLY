import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { jsPDF } from "jspdf";
import {
  Camera,
  FileText,
  Download,
  Trash2,
  RotateCw,
  Plus,
  ScanLine,
  X,
  Image as ImageIcon,
  Check,
  Crop,
  ChevronLeft,
  RefreshCw,
} from "lucide-react";
import "./style.css";

type Filter = "Original" | "Grayscale" | "B&W";
type CropBox = { x: number; y: number; w: number; h: number };
type Page = {
  id: number;
  src: string;
  filter: Filter;
  rotation: number;
  crop: CropBox;
};
const filters: Filter[] = ["Original", "Grayscale", "B&W"];
const fullCrop = { x: 0, y: 0, w: 100, h: 100 };
const guideCrop = { x: 8, y: 14, w: 84, h: 72 };
type Handle = "tl" | "tr" | "bl" | "br" | "t" | "b" | "l" | "r";

function App() {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    cropArea = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<Page[]>([]),
    [scanning, setScanning] = useState(false),
    [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<number | null>(null),
    [name, setName] = useState("Scanned Document"),
    [cameraInfo, setCameraInfo] = useState("");
  const [flash, setFlash] = useState(false),
    drag = useRef<{ h: Handle; crop: CropBox } | null>(null);
  useEffect(
    () => () => stream.current?.getTracks().forEach((t) => t.stop()),
    [],
  );
  async function openCamera() {
    setScanning(true);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 9999 },
          height: { ideal: 9999 },
        },
        audio: false,
      });
      const s = stream.current.getVideoTracks()[0]?.getSettings();
      if (s?.width && s?.height) setCameraInfo(`${s.width} × ${s.height}`);
      if (video.current) video.current.srcObject = stream.current;
    } catch {
      alert("Camera access was denied or unavailable.");
      setScanning(false);
    }
  }
  function addPage(src: string, crop = fullCrop) {
    const p = {
      id: Date.now() + Math.random(),
      src,
      filter: "Original" as Filter,
      rotation: 0,
      crop,
    };
    setPages((x) => [...x, p]);
    setSelected(p.id);
  }
  function capture() {
    if (!video.current?.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = video.current.videoWidth;
    c.height = video.current.videoHeight;
    c.getContext("2d", { alpha: false })!.drawImage(video.current, 0, 0);
    c.toBlob(
      (b) => {
        if (b) {
          addPage(URL.createObjectURL(b), { ...guideCrop });
          setFlash(true);
          setTimeout(() => setFlash(false), 850);
        }
      },
      "image/jpeg",
      0.98,
    );
  }
  function finishCapture() {
    stream.current?.getTracks().forEach((t) => t.stop());
    setScanning(false);
    if (pages.length) {
      setEditing(true);
      setSelected(pages[pages.length - 1].id);
    }
  }
  function upload(e: React.ChangeEvent<HTMLInputElement>) {
    Array.from(e.target.files || []).forEach((f) => {
      const r = new FileReader();
      r.onload = () => addPage(String(r.result));
      r.readAsDataURL(f);
    });
    if (e.target.files?.length) setTimeout(() => setEditing(true), 50);
    e.target.value = "";
  }
  function update(id: number, patch: Partial<Page>) {
    setPages((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  const current = pages.find((p) => p.id === selected) || pages[0];
  function beginCrop(h: Handle, e: React.PointerEvent) {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { h, crop: { ...current.crop } };
  }
  function moveCrop(e: React.PointerEvent) {
    if (!drag.current || !current || !cropArea.current) return;
    const rect = cropArea.current.getBoundingClientRect(),
      dx = ((e.clientX - (rect.left + rect.width / 2)) / rect.width) * 100,
      dy = ((e.clientY - (rect.top + rect.height / 2)) / rect.height) * 100;
    const h = drag.current.h,
      start = drag.current.crop;
    let n = { ...start },
      min = 8;
    const px = ((e.clientX - rect.left) / rect.width) * 100,
      py = ((e.clientY - rect.top) / rect.height) * 100;
    if (h.includes("l")) {
      const nx = Math.max(0, Math.min(px, start.x + start.w - min));
      n.w = start.x + start.w - nx;
      n.x = nx;
    }
    if (h.includes("r"))
      n.w = Math.max(min, Math.min(100 - start.x, px - start.x));
    if (h.includes("t")) {
      const ny = Math.max(0, Math.min(py, start.y + start.h - min));
      n.h = start.y + start.h - ny;
      n.y = ny;
    }
    if (h.includes("b"))
      n.h = Math.max(min, Math.min(100 - start.y, py - start.y));
    update(current.id, { crop: n });
  }
  function endCrop() {
    drag.current = null;
  }
  async function makePdf() {
    if (!pages.length) return;
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    for (let i = 0; i < pages.length; i++) {
      if (i) pdf.addPage();
      const p = pages[i],
        img = new Image();
      await new Promise<void>((r) => {
        img.onload = () => r();
        img.src = p.src;
      });
      const sx = (img.width * p.crop.x) / 100,
        sy = (img.height * p.crop.y) / 100,
        sw = (img.width * p.crop.w) / 100,
        sh = (img.height * p.crop.h) / 100,
        temp = document.createElement("canvas");
      temp.width = Math.round(sw);
      temp.height = Math.round(sh);
      const ctx = temp.getContext("2d")!;
      if (p.filter === "Grayscale") ctx.filter = "grayscale(1)";
      if (p.filter === "B&W")
        ctx.filter = "grayscale(1) contrast(2.5) brightness(1.12)";
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const ratio = sw / sh,
        maxW = 194,
        maxH = 281;
      let w = maxW,
        h = w / ratio;
      if (h > maxH) {
        h = maxH;
        w = h * ratio;
      }
      pdf.addImage(
        temp.toDataURL("image/jpeg", 0.98),
        "JPEG",
        (210 - w) / 2,
        (297 - h) / 2,
        w,
        h,
        undefined,
        "FAST",
      );
    }
    pdf.save(`${name.trim() || "Scanned Document"}.pdf`);
  }
  return (
    <div className="app">
      <header>
        <div className="brand">
          <ScanLine />
          <span>Scanly</span>
        </div>
        <span className="badge">Offline scanner</span>
      </header>
      <main>
        {!scanning && !editing && (
          <section className="hero">
            <div>
              <p className="eyebrow">MULTI-PAGE DOCUMENT SCANNER</p>
              <h1>Capture everything first. Edit afterward.</h1>
              <p className="sub">
                The camera guide automatically becomes the first crop. You can
                then fine-tune every document visually.
              </p>
              <div className="actions">
                <button className="primary" onClick={openCamera}>
                  <Camera size={20} /> Start multi-document scan
                </button>
                <label className="secondary">
                  <ImageIcon size={19} /> Add multiple images
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={upload}
                  />
                </label>
              </div>
            </div>
            <div className="hero-card">
              <FileText size={42} />
              <strong>Batch capture workflow</strong>
              <span>Scan many pages, then crop and filter together.</span>
            </div>
          </section>
        )}
        {editing && !scanning && current && (
          <section className="editor">
            <div className="editor-head">
              <div>
                <p className="eyebrow">VISUAL DOCUMENT EDITOR</p>
                <h2>
                  {pages.length} page{pages.length !== 1 ? "s" : ""} captured
                </h2>
              </div>
              <div className="editor-actions">
                <button className="secondary small" onClick={openCamera}>
                  <Plus size={17} /> Capture more
                </button>
                <button
                  className="secondary small"
                  onClick={() => setEditing(false)}
                >
                  <ChevronLeft size={17} /> Back
                </button>
              </div>
            </div>
            <div className="editor-layout">
              <aside className="page-list">
                {pages.map((p, i) => (
                  <button
                    className={
                      "page-tab " + (p.id === selected ? "active" : "")
                    }
                    onClick={() => setSelected(p.id)}
                    key={p.id}
                  >
                    <img src={p.src} />
                    <span>Page {i + 1}</span>
                  </button>
                ))}
              </aside>
              <div className="preview-area">
                <div
                  ref={cropArea}
                  className="crop-stage"
                  onPointerMove={moveCrop}
                  onPointerUp={endCrop}
                  onPointerCancel={endCrop}
                >
                  <img
                    className="stationary-image"
                    src={current.src}
                    style={{
                      filter:
                        current.filter === "Grayscale"
                          ? "grayscale(1)"
                          : current.filter === "B&W"
                            ? "grayscale(1) contrast(2.5) brightness(1.12)"
                            : "none",
                    }}
                  />
                  <div
                    className="crop-mask"
                    style={{
                      left: `${current.crop.x}%`,
                      top: `${current.crop.y}%`,
                      width: `${current.crop.w}%`,
                      height: `${current.crop.h}%`,
                    }}
                  >
                    <div className="crop-box">
                      {(
                        ["tl", "tr", "bl", "br", "t", "b", "l", "r"] as Handle[]
                      ).map((h) => (
                        <span
                          key={h}
                          className={"handle " + h}
                          onPointerDown={(e) => beginCrop(h, e)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <span className="crop-note">
                  Drag the corners or edges. The image remains fixed so you can
                  see exactly what is being cropped.
                </span>
              </div>
              <aside className="tools">
                <div className="tool-title">
                  <Crop size={18} /> Crop
                </div>
                <p className="tool-help">
                  Drag the white handles directly on the document.
                </p>
                <button
                  className="reset-crop"
                  onClick={() => update(current.id, { crop: { ...fullCrop } })}
                >
                  <RefreshCw size={16} /> Reset crop
                </button>
                <div className="tool-title">Filter</div>
                <div className="filter-buttons">
                  {filters.map((f) => (
                    <button
                      key={f}
                      className={current.filter === f ? "chosen" : ""}
                      onClick={() => update(current.id, { filter: f })}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <button
                  className="rotate-btn"
                  onClick={() =>
                    update(current.id, {
                      rotation: (current.rotation + 90) % 360,
                    })
                  }
                >
                  <RotateCw size={17} /> Rotate 90°
                </button>
                <button
                  className="delete-btn"
                  onClick={() => {
                    const rest = pages.filter((p) => p.id !== current.id);
                    setPages(rest);
                    setSelected(rest[0]?.id ?? null);
                  }}
                >
                  <Trash2 size={17} /> Delete page
                </button>
              </aside>
            </div>
            <div className="export">
              <div>
                <label>PDF filename</label>
                <input
                  value={name}
                  placeholder="Enter PDF name"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <button className="primary" onClick={makePdf}>
                <Download size={19} /> Generate & Download PDF
              </button>
            </div>
          </section>
        )}
        {scanning && (
          <section className="camera">
            <div className="camera-top">
              <button
                onClick={() => {
                  stream.current?.getTracks().forEach((t) => t.stop());
                  setScanning(false);
                }}
              >
                <X />
              </button>
              <div>
                <span>Multi-document scan</span>
                <small>
                  {pages.length} captured{cameraInfo ? ` · ${cameraInfo}` : ""}
                </small>
              </div>
              <button
                className="finish"
                disabled={!pages.length}
                onClick={finishCapture}
              >
                <Check size={18} /> Finish
              </button>
            </div>
            <video ref={video} autoPlay playsInline muted />
            <div className="guide">
              <span>Align document inside frame</span>
            </div>
            {flash && (
              <div className="captured">
                <Check size={28} />
                <b>Captured</b>
                <small>
                  {pages.length} page{pages.length !== 1 ? "s" : ""} ready
                </small>
              </div>
            )}
            <div className="capture-bottom">
              <button className="shutter" onClick={capture}>
                <span />
              </button>
              <p>Tap to capture · camera stays open for the next document</p>
            </div>
          </section>
        )}
      </main>
      <footer>Scanly · local-first multi-page document scanner</footer>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
