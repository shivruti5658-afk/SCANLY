import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { jsPDF } from "jspdf";
import {
  Camera,
  FileText,
  Download,
  Plus,
  ScanLine,
  X,
  Image as ImageIcon,
  Check,
  Crop,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Flashlight,
  FlashlightOff,
  Sparkles,
  Clock,
  Pencil,
  Trash2,
  ShieldCheck,
  RotateCcw,
  RotateCw,
  Type,
  Eye,
} from "lucide-react";
import "./style.css";

type Filter = "Original" | "Auto" | "Color+" | "Grayscale" | "B&W" | "Warm";
type CropBox = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };
type Corners = { tl: Point; tr: Point; br: Point; bl: Point };
type Page = {
  id: number;
  src: string;
  filter: Filter;
  crop: CropBox;
  corners?: Corners;
};
type SavedScan = { id: string; name: string; pages: Page[]; createdAt: number };
type Handle = "tl" | "tr" | "bl" | "br" | "t" | "b" | "l" | "r";
type CornerKey = "tl" | "tr" | "br" | "bl";
const filters: Filter[] = [
  "Original",
  "Auto",
  "Color+",
  "Grayscale",
  "B&W",
  "Warm",
];
const fullCrop = { x: 0, y: 0, w: 100, h: 100 };
const guideCrop = { x: 8, y: 14, w: 84, h: 72 };
const HISTORY_KEY = "scanly-editable-history-v1";
const MAX_HISTORY = 5;

function filterStyle(filter: Filter) {
  switch (filter) {
    case "Auto":
      return "contrast(1.18) brightness(1.06) saturate(1.05)";
    case "Color+":
      return "contrast(1.12) brightness(1.04) saturate(1.32)";
    case "Grayscale":
      return "grayscale(1) contrast(1.12) brightness(1.06)";
    case "B&W":
      return "grayscale(1) contrast(3.2) brightness(1.14)";
    case "Warm":
      return "sepia(.16) saturate(1.15) contrast(1.06) brightness(1.03)";
    default:
      return "none";
  }
}

function App() {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const cropArea = useRef<HTMLDivElement>(null);
  const drag = useRef<{ h: Handle; crop: CropBox } | null>(null);
  const cornerDrag = useRef<{ key: CornerKey } | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [scanning, setScanning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [name, setName] = useState("Scanned Document");
  const [flash, setFlash] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [torch, setTorch] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [recent, setRecent] = useState<SavedScan[]>([]);
  const [pdfPreview, setPdfPreview] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setRecent(JSON.parse(raw));
    } catch {}
    return () => stream.current?.getTracks().forEach((t) => t.stop());
  }, []);
  const stopCamera = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setTorch(false);
    setTorchSupported(false);
  };
  async function toggleTorch() {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torch;
      await (track as any).applyConstraints({ advanced: [{ torch: next }] });
      setTorch(next);
    } catch {
      alert("Flashlight is not supported by this camera or browser.");
    }
  }

  async function openCamera() {
    setScanning(true);
    try {
      // 1080p is a practical balance: sharp scans with a much faster preview/capture pipeline.
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 30 },
          focusMode: { ideal: "continuous" },
        } as any,
        audio: false,
      });
      stream.current = s;
      const track = s.getVideoTracks()[0];
      const capabilities = (track as any).getCapabilities?.();
      setTorchSupported(Boolean(capabilities?.torch));
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => {});
      }
    } catch {
      alert("Camera access was denied or unavailable.");
      setScanning(false);
    }
  }

  async function enhanceCapture(source: HTMLCanvasElement) {
    // Moderate unsharp mask: improves slight hand-motion softness without destroying text.
    const maxSide = 2200;
    let scale = Math.min(1, maxSide / Math.max(source.width, source.height));
    const w = Math.max(1, Math.round(source.width * scale)),
      h = Math.max(1, Math.round(source.height * scale));
    const base = document.createElement("canvas");
    base.width = w;
    base.height = h;
    const bctx = base.getContext("2d", { alpha: false })!;
    bctx.drawImage(source, 0, 0, w, h);
    const blurred = document.createElement("canvas");
    blurred.width = w;
    blurred.height = h;
    const blctx = blurred.getContext("2d", { alpha: false })!;
    blctx.filter = "blur(1.15px)";
    blctx.drawImage(base, 0, 0);
    blctx.filter = "none";
    const a = bctx.getImageData(0, 0, w, h),
      b = blctx.getImageData(0, 0, w, h);
    const d = a.data,
      bd = b.data,
      amount = 0.72;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.max(0, Math.min(255, d[i] + amount * (d[i] - bd[i])));
      d[i + 1] = Math.max(
        0,
        Math.min(255, d[i + 1] + amount * (d[i + 1] - bd[i + 1])),
      );
      d[i + 2] = Math.max(
        0,
        Math.min(255, d[i + 2] + amount * (d[i + 2] - bd[i + 2])),
      );
    }
    bctx.putImageData(a, 0, 0);
    return new Promise<string>((resolve) =>
      base.toBlob(
        (blob) =>
          resolve(
            blob
              ? URL.createObjectURL(blob)
              : base.toDataURL("image/jpeg", 0.98),
          ),
        "image/jpeg",
        0.98,
      ),
    );
  }

  function addPage(src: string, crop: CropBox = fullCrop) {
    const p = {
      id: Date.now() + Math.random(),
      src,
      filter: "Original" as Filter,
      crop,
    };
    setPages((ps) => [...ps, p]);
    setSelected(p.id);
  }

  async function capture() {
    const v = video.current;
    if (!v?.videoWidth || processing) return;
    setProcessing(true);
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c
      .getContext("2d", { alpha: false, desynchronized: true })
      ?.drawImage(v, 0, 0);
    // Capture instantly, then improve mild softness in post-processing.
    const enhanced = await enhanceCapture(c);
    addPage(enhanced, { ...guideCrop });
    setProcessing(false);
    setFlash(true);
    setTimeout(() => setFlash(false), 700);
  }

  function finishCapture() {
    stopCamera();
    setScanning(false);
    if (pages.length) {
      setEditing(true);
      setSelected(pages[pages.length - 1].id);
    }
  }

  function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    files.forEach((f) => {
      const r = new FileReader();
      r.onload = () => addPage(String(r.result));
      r.readAsDataURL(f);
    });
    if (files.length) setTimeout(() => setEditing(true), 50);
    e.target.value = "";
  }

  async function rotatePage(id: number, direction: 1 | -1) {
    const page = pages.find((p) => p.id === id);
    if (!page) return;
    const img = new Image();
    await new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.src = page.src;
    });
    const c = document.createElement("canvas");
    c.width = img.height;
    c.height = img.width;
    const ctx = c.getContext("2d")!;
    if (direction === 1) {
      ctx.translate(c.width, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      ctx.translate(0, c.height);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(img, 0, 0);
    update(id, {
      src: c.toDataURL("image/jpeg", 0.98),
      crop: { ...fullCrop },
      corners: undefined,
    });
  }

  function update(id: number, patch: Partial<Page>) {
    setPages((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function movePage(id: number, direction: -1 | 1) {
    setPages((ps) => {
      const index = ps.findIndex((p) => p.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= ps.length) return ps;
      const copy = [...ps];
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy;
    });
  }
  const current = pages.find((p) => p.id === selected) || pages[0];

  function beginCrop(h: Handle, e: React.PointerEvent) {
    e.preventDefault();
    drag.current = { h, crop: { ...current.crop } };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function beginCorner(key: CornerKey, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    cornerDrag.current = { key };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function moveCrop(e: React.PointerEvent) {
    if (!drag.current || !current || !cropArea.current) return;
    const r = cropArea.current.getBoundingClientRect();
    const px = Math.max(
      0,
      Math.min(100, ((e.clientX - r.left) / r.width) * 100),
    );
    const py = Math.max(
      0,
      Math.min(100, ((e.clientY - r.top) / r.height) * 100),
    );
    const s = drag.current.crop,
      h = drag.current.h,
      min = 8;
    let n = { ...s };
    if (h.includes("l")) {
      const x = Math.min(px, s.x + s.w - min);
      n.x = x;
      n.w = s.x + s.w - x;
    }
    if (h.includes("r")) n.w = Math.max(min, px - s.x);
    if (h.includes("t")) {
      const y = Math.min(py, s.y + s.h - min);
      n.y = y;
      n.h = s.y + s.h - y;
    }
    if (h.includes("b")) n.h = Math.max(min, py - s.y);
    n.x = Math.max(0, n.x);
    n.y = Math.max(0, n.y);
    n.w = Math.min(n.w, 100 - n.x);
    n.h = Math.min(n.h, 100 - n.y);
    update(current.id, { crop: n, corners: undefined });
  }
  function moveCorner(e: React.PointerEvent) {
    if (!cornerDrag.current || !current || !cropArea.current) return;
    const r = cropArea.current.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(100, ((e.clientX - r.left) / r.width) * 100),
    );
    const y = Math.max(
      0,
      Math.min(100, ((e.clientY - r.top) / r.height) * 100),
    );
    const base = current.corners || {
      tl: { x: current.crop.x, y: current.crop.y },
      tr: { x: current.crop.x + current.crop.w, y: current.crop.y },
      br: {
        x: current.crop.x + current.crop.w,
        y: current.crop.y + current.crop.h,
      },
      bl: { x: current.crop.x, y: current.crop.y + current.crop.h },
    };
    const corners = { ...base, [cornerDrag.current.key]: { x, y } };
    update(current.id, { corners });
  }
  const endCrop = () => {
    drag.current = null;
    cornerDrag.current = null;
  };

  async function compactForHistory(src: string) {
    const img = new Image();
    await new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.src = src;
    });
    const maxSide = 1100,
      scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext("2d", { alpha: false })!.drawImage(
      img,
      0,
      0,
      c.width,
      c.height,
    );
    return c.toDataURL("image/jpeg", 0.76);
  }
  async function saveToHistory() {
    if (!pages.length) return;
    try {
      const savedPages = await Promise.all(
        pages.map(async (p) => ({ ...p, src: await compactForHistory(p.src) })),
      );
      const item: SavedScan = {
        id: `${Date.now()}-${Math.random()}`,
        name: name.trim() || "Scanned Document",
        pages: savedPages,
        createdAt: Date.now(),
      };
      const next = [item, ...recent].slice(0, MAX_HISTORY);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      setRecent(next);
    } catch {
      alert(
        "This scan is too large to keep in local storage. Try fewer pages or smaller images.",
      );
    }
  }
  function openSaved(item: SavedScan) {
    stopCamera();
    setPages(item.pages.map((p) => ({ ...p, id: Date.now() + Math.random() })));
    setName(item.name);
    setSelected(null);
    setEditing(true);
  }
  function deleteSaved(id: string) {
    const next = recent.filter((x) => x.id !== id);
    setRecent(next);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {}
  }

  async function makePdf() {
    if (!pages.length) return;
    try {
      let pdf: jsPDF | undefined;
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const p = pages[pageIndex];
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () =>
            reject(new Error(`Could not load page ${pageIndex + 1}`));
          img.src = p.src;
        });

        const points = p.corners
          ? [p.corners.tl, p.corners.tr, p.corners.br, p.corners.bl]
          : [
              { x: p.crop.x, y: p.crop.y },
              { x: p.crop.x + p.crop.w, y: p.crop.y },
              { x: p.crop.x + p.crop.w, y: p.crop.y + p.crop.h },
              { x: p.crop.x, y: p.crop.y + p.crop.h },
            ];

        const minX = Math.max(0, Math.min(...points.map((q) => q.x))),
          maxX = Math.min(100, Math.max(...points.map((q) => q.x)));
        const minY = Math.max(0, Math.min(...points.map((q) => q.y))),
          maxY = Math.min(100, Math.max(...points.map((q) => q.y)));
        const sx = Math.round((img.width * minX) / 100),
          sy = Math.round((img.height * minY) / 100);
        const sw = Math.max(1, Math.round((img.width * (maxX - minX)) / 100)),
          sh = Math.max(1, Math.round((img.height * (maxY - minY)) / 100));

        // Safe canvas size for high-resolution phone cameras.
        const maxSide = 2600,
          scale = Math.min(1, maxSide / Math.max(sw, sh));
        const cw = Math.max(1, Math.round(sw * scale)),
          ch = Math.max(1, Math.round(sh * scale));
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, cw, ch);

        if (p.corners) {
          ctx.save();
          ctx.beginPath();
          points.forEach((q, i) => {
            const x = ((q.x - minX) / (maxX - minX)) * cw,
              y = ((q.y - minY) / (maxY - minY)) * ch;
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          });
          ctx.closePath();
          ctx.clip();
        }
        ctx.filter = filterStyle(p.filter);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
        if (p.corners) ctx.restore();

        const landscape = cw >= ch;
        if (!pdf)
          pdf = new jsPDF({
            unit: "mm",
            format: "a4",
            orientation: landscape ? "landscape" : "portrait",
            compress: true,
          });
        else pdf.addPage("a4", landscape ? "landscape" : "portrait");

        // Scale to fit the ENTIRE image inside the visible PDF page. No zoom/cutoff.
        const pageW = pdf.internal.pageSize.getWidth(),
          pageH = pdf.internal.pageSize.getHeight();
        const ratio = Math.min(pageW / cw, pageH / ch);
        const drawW = cw * ratio,
          drawH = ch * ratio;
        pdf.addImage(
          canvas.toDataURL("image/jpeg", 0.94),
          "JPEG",
          (pageW - drawW) / 2,
          (pageH - drawH) / 2,
          drawW,
          drawH,
          undefined,
          "FAST",
        );
      }

      if (!pdf) return;
      const safeName = (name.trim() || "Scanned Document")
        .replace(/[\\/:*?"<>|]+/g, "-")
        .replace(/\.pdf$/i, "");
      const blob = pdf.output("blob");
      if (pdfPreview) URL.revokeObjectURL(pdfPreview);
      const url = URL.createObjectURL(blob);
      setPdfPreview(url);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}.pdf`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      void saveToHistory();
    } catch (error) {
      console.error("PDF generation failed:", error);
      alert(
        `PDF generation failed: ${error instanceof Error ? error.message : "Please try again."}`,
      );
    }
  }

  return (
    <>
      <style>{`
      .pdf-actions {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .pdf-preview-overlay {
        position: fixed;
        inset: 0;
        background: rgba(12, 18, 30, 0.72);
        z-index: 9999;
        padding: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .pdf-preview-card {
        width: min(100%, 900px);
        height: min(92vh, 1000px);
        background: #fff;
        border-radius: 18px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.35);
      }

      .pdf-preview-header {
        height: 58px;
        padding: 0 14px 0 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid #e8ebf1;
      }

      .pdf-preview-header button {
        border: 0;
        background: #f1f3f7;
        border-radius: 10px;
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
      }

      .pdf-preview-frame {
        width: 100%;
        flex: 1;
        border: 0;
        background: #eef1f5;
      }

      @media (max-width: 520px) {
        .pdf-preview-overlay {
          padding: 0;
        }

        .pdf-preview-card {
          width: 100%;
          height: 100vh;
          border-radius: 0;
        }

        .pdf-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
        }

        .pdf-actions button {
          justify-content: center;
        }
      }
    `}</style>

      <div className="app">
        <header>
          <div className="brand">
            <ScanLine />
            <span>Scanly</span>
          </div>

          <span className="badge">Offline scanner</span>
        </header>

        <main>
          {/* YOUR EXISTING APP CONTENT GOES HERE */}
          {!scanning && !editing && (
            <section className="home-screen">
              <div className="premium-hero">
                <div className="hero-copy">
                  <div className="hero-kicker">
                    <Sparkles size={15} /> PREMIUM DOCUMENT SCANNER
                  </div>
                  <div className="logo-lockup">
                    <div className="logo-orb">
                      <ScanLine size={34} />
                    </div>
                    <div>
                      <h1>
                        Scan beautifully.
                        <br />
                        <em>Keep everything editable.</em>
                      </h1>
                    </div>
                  </div>
                  <p>
                    Capture documents, enhance clarity, fine-tune the crop, and
                    turn multiple pages into a clean PDF — directly on your
                    device.
                  </p>
                  <div className="actions">
                    <button
                      className="primary home-primary"
                      onClick={openCamera}
                    >
                      <Camera size={20} /> Start scanning
                    </button>
                    <label className="secondary home-secondary">
                      <ImageIcon size={19} /> Import images
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={upload}
                      />
                    </label>
                  </div>
                  <div className="trust-row">
                    <span>
                      <ShieldCheck size={16} /> Local-first
                    </span>
                    <span>
                      <Sparkles size={16} /> Smart enhancement
                    </span>
                    <span>
                      <FileText size={16} /> Multi-page PDF
                    </span>
                  </div>
                </div>
                <div className="scan-showcase">
                  <div className="showcase-glow"></div>
                  <div className="floating-doc doc-back"></div>
                  <div className="floating-doc doc-front">
                    <div className="mini-logo">
                      <ScanLine size={18} /> Scanly
                    </div>
                    <div className="doc-lines">
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <div className="doc-stamp">READY</div>
                  </div>
                  <div className="showcase-chip">
                    <Sparkles size={15} /> Clear. Fast. Private.
                  </div>
                </div>
              </div>
              <section className="recent-section">
                <div className="section-title">
                  <div>
                    <span className="section-eyebrow">
                      <Clock size={14} /> YOUR DEVICE
                    </span>
                    <h2>Recent editable scans</h2>
                  </div>
                  <span className="recent-count">{recent.length}/5 saved</span>
                </div>
                {recent.length ? (
                  <div className="recent-grid">
                    {recent.map((item) => (
                      <article className="recent-card" key={item.id}>
                        <button
                          className="recent-main"
                          onClick={() => openSaved(item)}
                        >
                          <div className="recent-thumb">
                            {item.pages[0] && <img src={item.pages[0].src} />}
                            <span>{item.pages.length} pg</span>
                          </div>
                          <div className="recent-info">
                            <strong>{item.name}</strong>
                            <small>
                              {new Date(item.createdAt).toLocaleDateString()} ·
                              Editable
                            </small>
                          </div>
                          <Pencil size={17} />
                        </button>
                        <button
                          className="recent-delete"
                          onClick={() => deleteSaved(item.id)}
                          aria-label={`Delete ${item.name}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="recent-empty">
                    <div>
                      <Clock size={23} />
                    </div>
                    <strong>Your last 5 scans will appear here</strong>
                    <span>
                      Download a PDF once, then reopen it later to continue
                      editing.
                    </span>
                  </div>
                )}
              </section>
            </section>
          )}

          {editing && !scanning && current && (
            <section className="editor">
              <div className="editor-head compact-editor-head">
                <div className="mobile-brand-line">
                  <ScanLine size={21} />
                  <strong>Scanly</strong>
                  <span className="page-count">
                    {pages.length} page{pages.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="editor-actions">
                  <button className="secondary small" onClick={openCamera}>
                    <Plus size={17} />
                    <span>Add pages</span>
                  </button>
                  <button
                    className="secondary small"
                    onClick={() => setEditing(false)}
                  >
                    <ChevronLeft size={17} />
                    <span>Back</span>
                  </button>
                </div>
              </div>
              <div className="simple-editor">
                <div className="page-strip">
                  {pages.map((p, i) => (
                    <div
                      key={p.id}
                      className={
                        "page-item " + (p.id === selected ? "active" : "")
                      }
                    >
                      <button
                        className="page-tab"
                        onClick={() => setSelected(p.id)}
                        aria-label={`Select page ${i + 1}`}
                      >
                        <img src={p.src} />
                        <span>{i + 1}</span>
                      </button>
                      {p.id === selected && pages.length > 1 && (
                        <div className="page-order-controls">
                          <button
                            onClick={() => movePage(p.id, -1)}
                            disabled={i === 0}
                            aria-label="Move page earlier"
                          >
                            <ChevronLeft size={14} />
                          </button>
                          <button
                            onClick={() => movePage(p.id, 1)}
                            disabled={i === pages.length - 1}
                            aria-label="Move page later"
                          >
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="preview-area">
                  <div
                    ref={cropArea}
                    className="crop-stage"
                    onPointerMove={(e) => {
                      moveCrop(e);
                      moveCorner(e);
                    }}
                    onPointerUp={endCrop}
                    onPointerCancel={endCrop}
                  >
                    <img
                      className="stationary-image"
                      src={current.src}
                      style={{ filter: filterStyle(current.filter) }}
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
                        {(["t", "b", "l", "r"] as Handle[]).map((h) => (
                          <span
                            key={h}
                            className={"handle " + h}
                            onPointerDown={(e) => beginCrop(h, e)}
                          />
                        ))}
                      </div>
                    </div>
                    <svg
                      className="corner-crop"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                    >
                      {(() => {
                        const c = current.corners || {
                          tl: { x: current.crop.x, y: current.crop.y },
                          tr: {
                            x: current.crop.x + current.crop.w,
                            y: current.crop.y,
                          },
                          br: {
                            x: current.crop.x + current.crop.w,
                            y: current.crop.y + current.crop.h,
                          },
                          bl: {
                            x: current.crop.x,
                            y: current.crop.y + current.crop.h,
                          },
                        };
                        return (
                          <>
                            <polygon
                              points={`${c.tl.x},${c.tl.y} ${c.tr.x},${c.tr.y} ${c.br.x},${c.br.y} ${c.bl.x},${c.bl.y}`}
                              className="corner-shape"
                            />
                            {(["tl", "tr", "br", "bl"] as CornerKey[]).map(
                              (k) => (
                                <circle
                                  key={k}
                                  cx={c[k].x}
                                  cy={c[k].y}
                                  r="1.9"
                                  className="corner-handle"
                                  onPointerDown={(e) => beginCorner(k, e)}
                                />
                              ),
                            )}
                          </>
                        );
                      })()}
                    </svg>
                  </div>
                </div>
                <div className="edit-controls">
                  <div className="crop-label">
                    <Crop size={17} /> Drag corners or edges to crop
                  </div>
                  <div className="image-tools">
                    <button
                      className="reset-crop"
                      onClick={() => rotatePage(current.id, -1)}
                    >
                      <RotateCcw size={16} /> Rotate left
                    </button>
                    <button
                      className="reset-crop"
                      onClick={() => rotatePage(current.id, 1)}
                    >
                      <RotateCw size={16} /> Rotate right
                    </button>
                    <button
                      className="reset-crop"
                      onClick={() =>
                        update(current.id, {
                          crop: { ...fullCrop },
                          corners: undefined,
                        })
                      }
                    >
                      <RefreshCw size={16} /> Reset crop
                    </button>
                  </div>
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
                </div>
              </div>
              <div className="export">
                <div className="filename-box">
                  <label>
                    <Type size={14} /> PDF filename{" "}
                    <span>changes instantly</span>
                  </label>
                  <input
                    value={name}
                    placeholder="Enter PDF name"
                    onChange={(e) => setName(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <small>{name.trim() || "Scanned Document"}.pdf</small>
                </div>
                <div className="pdf-actions">
                  <button className="primary" onClick={makePdf}>
                    <Download size={19} /> Download PDF
                  </button>
                  {pdfPreview && (
                    <button
                      className="secondary"
                      onClick={() => setPdfPreview(pdfPreview)}
                    >
                      <Eye size={18} /> View PDF
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}

          {scanning && (
            <section className="camera">
              <div className="camera-top">
                <button
                  onClick={() => {
                    stopCamera();
                    setScanning(false);
                  }}
                >
                  <X />
                </button>
                <div>
                  <span>Multi-document scan</span>
                  <small>{pages.length} captured</small>
                </div>
                <div className="camera-actions">
                  {torchSupported && (
                    <button
                      className={"torch " + (torch ? "on" : "")}
                      onClick={toggleTorch}
                      title={
                        torch ? "Turn flashlight off" : "Turn flashlight on"
                      }
                    >
                      {torch ? (
                        <FlashlightOff size={20} />
                      ) : (
                        <Flashlight size={20} />
                      )}
                    </button>
                  )}
                </div>
              </div>
              <video ref={video} autoPlay playsInline muted />
              <div className="guide">
                <span>Align document inside frame</span>
              </div>
              {processing && (
                <div className="processing-scan">
                  <span></span>Enhancing scan…
                </div>
              )}
              {flash && (
                <div className="captured">
                  <Check size={28} />
                  <b>Captured</b>
                  <small>
                    {pages.length} page{pages.length !== 1 ? "s" : ""} ready
                  </small>
                </div>
              )}
              <button
                className="finish camera-finish"
                disabled={!pages.length}
                onClick={finishCapture}
              >
                <Check size={18} />
                <span>Finish</span>
              </button>
              <div className="capture-bottom">
                <button
                  className="shutter"
                  onClick={capture}
                  aria-label="Capture document"
                  disabled={processing}
                >
                  <span />
                </button>
                <p>
                  {processing
                    ? "Enhancing captured scan…"
                    : "Tap to capture · automatic clarity enhancement"}
                </p>
              </div>
            </section>
          )}
          {pdfPreview && (
            <div
              className="pdf-preview-overlay"
              role="dialog"
              aria-modal="true"
            >
              <div className="pdf-preview-card">
                <div className="pdf-preview-header">
                  <strong>PDF Preview</strong>
                  <button
                    onClick={() => setPdfPreview(null)}
                    aria-label="Close PDF preview"
                  >
                    <X size={20} />
                  </button>
                </div>
                <iframe
                  src={pdfPreview}
                  title="PDF Preview"
                  className="pdf-preview-frame"
                />
              </div>
            </div>
          )}
        </main>
        <footer>Scanly · local-first document scanner</footer>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
