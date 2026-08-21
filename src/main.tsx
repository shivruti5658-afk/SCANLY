import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {jsPDF} from 'jspdf';
import {Camera,FileText,Download,Plus,ScanLine,X,Image as ImageIcon,Check,Crop,ChevronLeft,RefreshCw,Flashlight,FlashlightOff} from 'lucide-react';
import './style.css';

type Filter='Original'|'Grayscale'|'B&W';
type CropBox={x:number;y:number;w:number;h:number};
type Page={id:number;src:string;filter:Filter;crop:CropBox};
type Handle='tl'|'tr'|'bl'|'br'|'t'|'b'|'l'|'r';
const filters:Filter[]=['Original','Grayscale','B&W'];
const fullCrop={x:0,y:0,w:100,h:100};
const guideCrop={x:8,y:14,w:84,h:72};

function App(){
 const video=useRef<HTMLVideoElement>(null);
 const stream=useRef<MediaStream|null>(null);
 const cropArea=useRef<HTMLDivElement>(null);
 const drag=useRef<{h:Handle;crop:CropBox}|null>(null);
 const [pages,setPages]=useState<Page[]>([]);
 const [scanning,setScanning]=useState(false);
 const [editing,setEditing]=useState(false);
 const [selected,setSelected]=useState<number|null>(null);
 const [name,setName]=useState('Scanned Document');
 const [flash,setFlash]=useState(false);
 const [torch,setTorch]=useState(false);
 const [torchSupported,setTorchSupported]=useState(false);

 useEffect(()=>()=>stream.current?.getTracks().forEach(t=>t.stop()),[]);
 const stopCamera=()=>{stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;setTorch(false);setTorchSupported(false)};
 async function toggleTorch(){
  const track=stream.current?.getVideoTracks()[0];
  if(!track)return;
  try{
   const next=!torch;
   await (track as any).applyConstraints({advanced:[{torch:next}]});
   setTorch(next);
  }catch{alert('Flashlight is not supported by this camera or browser.')}
 }

 async function openCamera(){
  setScanning(true);
  try{
   // 1080p is a practical balance: sharp scans with a much faster preview/capture pipeline.
   const s=await navigator.mediaDevices.getUserMedia({
    video:{facingMode:{ideal:'environment'},width:{ideal:1920,max:1920},height:{ideal:1080,max:1080},frameRate:{ideal:30,max:30}},
    audio:false
   });
   stream.current=s;
   const track=s.getVideoTracks()[0];
   const capabilities=(track as any).getCapabilities?.();
   setTorchSupported(Boolean(capabilities?.torch));
   if(video.current){video.current.srcObject=s;await video.current.play().catch(()=>{})}
  }catch{alert('Camera access was denied or unavailable.');setScanning(false)}
 }

 function addPage(src:string,crop:CropBox=fullCrop){
  const p={id:Date.now()+Math.random(),src,filter:'Original' as Filter,crop};
  setPages(ps=>[...ps,p]);setSelected(p.id);
 }

 function capture(){
  const v=video.current;if(!v?.videoWidth)return;
  const c=document.createElement('canvas');
  c.width=v.videoWidth;c.height=v.videoHeight;
  const ctx=c.getContext('2d',{alpha:false,desynchronized:true});
  ctx?.drawImage(v,0,0);
  // Fast encoding while retaining high visual quality.
  c.toBlob(blob=>{
   if(!blob)return;
   addPage(URL.createObjectURL(blob),{...guideCrop});
   setFlash(true);setTimeout(()=>setFlash(false),650);
  },'image/jpeg',0.96);
 }

 function finishCapture(){
  stopCamera();setScanning(false);
  if(pages.length){setEditing(true);setSelected(pages[pages.length-1].id)}
 }

 function upload(e:React.ChangeEvent<HTMLInputElement>){
  const files=Array.from(e.target.files||[]);
  files.forEach(f=>{const r=new FileReader();r.onload=()=>addPage(String(r.result));r.readAsDataURL(f)});
  if(files.length)setTimeout(()=>setEditing(true),50);
  e.target.value='';
 }

 function update(id:number,patch:Partial<Page>){setPages(ps=>ps.map(p=>p.id===id?{...p,...patch}:p))}
 const current=pages.find(p=>p.id===selected)||pages[0];

 function beginCrop(h:Handle,e:React.PointerEvent){
  e.preventDefault();drag.current={h,crop:{...current.crop}};
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
 }
 function moveCrop(e:React.PointerEvent){
  if(!drag.current||!current||!cropArea.current)return;
  const r=cropArea.current.getBoundingClientRect();
  const px=Math.max(0,Math.min(100,(e.clientX-r.left)/r.width*100));
  const py=Math.max(0,Math.min(100,(e.clientY-r.top)/r.height*100));
  const s=drag.current.crop,h=drag.current.h,min=8;let n={...s};
  if(h.includes('l')){const x=Math.min(px,s.x+s.w-min);n.x=x;n.w=s.x+s.w-x}
  if(h.includes('r'))n.w=Math.max(min,px-s.x);
  if(h.includes('t')){const y=Math.min(py,s.y+s.h-min);n.y=y;n.h=s.y+s.h-y}
  if(h.includes('b'))n.h=Math.max(min,py-s.y);
  n.x=Math.max(0,n.x);n.y=Math.max(0,n.y);n.w=Math.min(n.w,100-n.x);n.h=Math.min(n.h,100-n.y);
  update(current.id,{crop:n});
 }
 const endCrop=()=>{drag.current=null};

 async function makePdf(){
  if(!pages.length)return;
  let pdf:jsPDF|undefined;
  for(const p of pages){
   const img=new Image();
   await new Promise<void>(resolve=>{img.onload=()=>resolve();img.src=p.src});
   const sx=img.width*p.crop.x/100,sy=img.height*p.crop.y/100;
   const sw=img.width*p.crop.w/100,sh=img.height*p.crop.h/100;
   const canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(sw));canvas.height=Math.max(1,Math.round(sh));
   const ctx=canvas.getContext('2d')!;
   if(p.filter==='Grayscale')ctx.filter='grayscale(1)';
   if(p.filter==='B&W')ctx.filter='grayscale(1) contrast(2.5) brightness(1.12)';
   ctx.drawImage(img,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
   // Each PDF page has the exact cropped image aspect ratio, so there is no white border.
   const w=canvas.width,h=canvas.height;
   if(!pdf)pdf=new jsPDF({unit:'px',format:[w,h],orientation:w>=h?'landscape':'portrait',hotfixes:['px_scaling']});
   else pdf.addPage([w,h],w>=h?'landscape':'portrait');
   pdf.addImage(canvas.toDataURL('image/jpeg',0.98),'JPEG',0,0,w,h,undefined,'FAST');
  }
  pdf?.save(`${name.trim()||'Scanned Document'}.pdf`);
 }

 return <div className="app"><header><div className="brand"><ScanLine/><span>Scanly</span></div><span className="badge">Offline scanner</span></header><main>
 {!scanning&&!editing&&<section className="hero"><div><p className="eyebrow">MULTI-PAGE DOCUMENT SCANNER</p><h1>Capture everything first. Edit afterward.</h1><p className="sub">Fast multi-page scanning with visual crop controls and clean PDF export.</p><div className="actions"><button className="primary" onClick={openCamera}><Camera size={20}/> Start scanning</button><label className="secondary"><ImageIcon size={19}/> Add images<input type="file" accept="image/*" multiple onChange={upload}/></label></div></div><div className="hero-card"><FileText size={42}/><strong>Batch document scanner</strong><span>Everything stays on your device.</span></div></section>}

 {editing&&!scanning&&current&&<section className="editor">
  <div className="editor-head"><div><p className="eyebrow">EDIT DOCUMENT</p><h2>{pages.length} page{pages.length!==1?'s':''}</h2></div><div className="editor-actions"><button className="secondary small" onClick={openCamera}><Plus size={17}/> Add pages</button><button className="secondary small" onClick={()=>setEditing(false)}><ChevronLeft size={17}/> Back</button></div></div>
  <div className="simple-editor">
   <div className="page-strip">{pages.map((p,i)=><button key={p.id} className={'page-tab '+(p.id===selected?'active':'')} onClick={()=>setSelected(p.id)}><img src={p.src}/><span>{i+1}</span></button>)}</div>
   <div className="preview-area"><div ref={cropArea} className="crop-stage" onPointerMove={moveCrop} onPointerUp={endCrop} onPointerCancel={endCrop}>
    <img className="stationary-image" src={current.src} style={{filter:current.filter==='Grayscale'?'grayscale(1)':current.filter==='B&W'?'grayscale(1) contrast(2.5) brightness(1.12)':'none'}}/>
    <div className="crop-mask" style={{left:`${current.crop.x}%`,top:`${current.crop.y}%`,width:`${current.crop.w}%`,height:`${current.crop.h}%`}}><div className="crop-box">{(['tl','tr','bl','br','t','b','l','r'] as Handle[]).map(h=><span key={h} className={'handle '+h} onPointerDown={e=>beginCrop(h,e)}/>)}</div></div>
   </div></div>
   <div className="edit-controls"><div className="crop-label"><Crop size={17}/> Drag corners or edges to crop</div><button className="reset-crop" onClick={()=>update(current.id,{crop:{...fullCrop}})}><RefreshCw size={16}/> Reset</button><div className="filter-buttons">{filters.map(f=><button key={f} className={current.filter===f?'chosen':''} onClick={()=>update(current.id,{filter:f})}>{f}</button>)}</div></div>
  </div>
  <div className="export"><div><label>PDF filename</label><input value={name} placeholder="Enter PDF name" onChange={e=>setName(e.target.value)}/></div><button className="primary" onClick={makePdf}><Download size={19}/> Download PDF</button></div>
 </section>}

 {scanning&&<section className="camera"><div className="camera-top"><button onClick={()=>{stopCamera();setScanning(false)}}><X/></button><div><span>Multi-document scan</span><small>{pages.length} captured</small></div><div className="camera-actions">{torchSupported&&<button className={'torch '+(torch?'on':'')} onClick={toggleTorch} title={torch?'Turn flashlight off':'Turn flashlight on'}>{torch?<FlashlightOff size={20}/>:<Flashlight size={20}/>}</button>}<button className="finish" disabled={!pages.length} onClick={finishCapture}><Check size={18}/> Finish</button></div></div><video ref={video} autoPlay playsInline muted/><div className="guide"><span>Align document inside frame</span></div>{flash&&<div className="captured"><Check size={28}/><b>Captured</b><small>{pages.length} page{pages.length!==1?'s':''} ready</small></div>}<div className="capture-bottom"><button className="shutter" onClick={capture}><span/></button><p>Tap to capture · camera stays ready</p></div></section>}
 </main><footer>Scanly · local-first document scanner</footer></div>
}
createRoot(document.getElementById('root')!).render(<App/>);
