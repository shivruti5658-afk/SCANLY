import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {jsPDF} from 'jspdf';
import {Camera,FileText,Download,Trash2,RotateCw,Plus,ScanLine,X,Image as ImageIcon,Check,Crop,ChevronLeft,SlidersHorizontal} from 'lucide-react';
import './style.css';

type Filter='Original'|'Grayscale'|'B&W';
type Page={id:number;src:string;filter:Filter;rotation:number;crop:{x:number;y:number;w:number;h:number}};
const filters:Filter[]=['Original','Grayscale','B&W'];
const defaultCrop={x:0,y:0,w:100,h:100};

function filteredCanvas(p:Page):HTMLCanvasElement{
 const img=new Image(); img.src=p.src;
 const c=document.createElement('canvas');
 // The image is already loaded before this is used by the PDF action.
 const sx=img.width*p.crop.x/100, sy=img.height*p.crop.y/100;
 const sw=img.width*p.crop.w/100, sh=img.height*p.crop.h/100;
 c.width=p.rotation%180?Math.max(1,Math.round(sh)):Math.max(1,Math.round(sw));
 c.height=p.rotation%180?Math.max(1,Math.round(sw)):Math.max(1,Math.round(sh));
 const ctx=c.getContext('2d')!;
 if(p.filter==='Grayscale') ctx.filter='grayscale(1)';
 if(p.filter==='B&W') ctx.filter='grayscale(1) contrast(2.5) brightness(1.12)';
 ctx.translate(c.width/2,c.height/2);ctx.rotate(p.rotation*Math.PI/180);
 ctx.drawImage(img,sx,sy,sw,sh,-sw/2,-sh/2,sw,sh);
 return c;
}
function App(){
 const video=useRef<HTMLVideoElement>(null); const stream=useRef<MediaStream|null>(null);
 const [pages,setPages]=useState<Page[]>([]);
 const [scanning,setScanning]=useState(false);
 const [editing,setEditing]=useState(false);
 const [selected,setSelected]=useState<number|null>(null);
 const [name,setName]=useState('Scanned Document');
 const [cameraInfo,setCameraInfo]=useState('');
 useEffect(()=>()=>stream.current?.getTracks().forEach(t=>t.stop()),[]);
 async function openCamera(){
  setScanning(true);
  try{
   stream.current=await navigator.mediaDevices.getUserMedia({
    video:{facingMode:{ideal:'environment'},width:{ideal:9999},height:{ideal:9999},frameRate:{ideal:60}},audio:false
   });
   const track=stream.current.getVideoTracks()[0]; const settings=track?.getSettings();
   if(settings?.width&&settings?.height)setCameraInfo(`${settings.width} × ${settings.height}`);
   if(video.current)video.current.srcObject=stream.current;
  }catch{alert('Camera access was denied or is unavailable. You can still add images.');setScanning(false)}
 }
 function addPage(src:string){
  const page={id:Date.now()+Math.random(),src,filter:'Original' as Filter,rotation:0,crop:{...defaultCrop}};
  setPages(p=>[...p,page]); setSelected(page.id);
 }
 function capture(){
  if(!video.current||!video.current.videoWidth)return;
  // Preserve the actual camera stream dimensions; no resize/downsampling here.
  const c=document.createElement('canvas');c.width=video.current.videoWidth;c.height=video.current.videoHeight;
  c.getContext('2d',{alpha:false})!.drawImage(video.current,0,0);
  c.toBlob(blob=>{if(blob)addPage(URL.createObjectURL(blob));},'image/jpeg',0.98);
 }
 function finishCapture(){stream.current?.getTracks().forEach(t=>t.stop());setScanning(false);if(pages.length){setEditing(true);setSelected(pages[pages.length-1].id)}}
 function upload(e:React.ChangeEvent<HTMLInputElement>){
  const files=Array.from(e.target.files||[]);
  files.forEach((f,i)=>{const r=new FileReader();r.onload=()=>addPage(String(r.result));r.readAsDataURL(f)});
  if(files.length)setTimeout(()=>setEditing(true),100);
  e.target.value='';
 }
 function update(id:number,patch:Partial<Page>){setPages(p=>p.map(x=>x.id===id?{...x,...patch}:x))}
 function setCrop(key:keyof Page['crop'],value:number){
  if(selected==null)return;
  const page=pages.find(p=>p.id===selected); if(!page)return;
  let next={...page.crop,[key]:value};
  if(key==='x')next.w=Math.min(next.w,100-value);
  if(key==='y')next.h=Math.min(next.h,100-value);
  if(key==='w')next.w=Math.min(next.w,100-next.x);
  if(key==='h')next.h=Math.min(next.h,100-next.y);
  update(selected,{crop:next});
 }
 async function makePdf(){
  if(!pages.length)return;
  const pdf=new jsPDF({unit:'mm',format:'a4'});
  for(let i=0;i<pages.length;i++){
   if(i)pdf.addPage();
   const p=pages[i]; const img=new Image();
   await new Promise<void>((resolve)=>{img.onload=()=>resolve();img.src=p.src});
   const sx=img.width*p.crop.x/100,sy=img.height*p.crop.y/100,sw=img.width*p.crop.w/100,sh=img.height*p.crop.h/100;
   const temp=document.createElement('canvas'); temp.width=Math.round(sw);temp.height=Math.round(sh);
   const ctx=temp.getContext('2d')!;
   if(p.filter==='Grayscale')ctx.filter='grayscale(1)';
   if(p.filter==='B&W')ctx.filter='grayscale(1) contrast(2.5) brightness(1.12)';
   ctx.drawImage(img,sx,sy,sw,sh,0,0,sw,sh);
   const data=temp.toDataURL('image/jpeg',.98);
   const ratio=sw/sh, maxW=194,maxH=281;let w=maxW,h=w/ratio;if(h>maxH){h=maxH;w=h*ratio}
   pdf.addImage(data,'JPEG',(210-w)/2,(297-h)/2,w,h,undefined,'FAST');
  }
  pdf.save(`${name||'Scanned Document'}.pdf`);
 }
 const current=pages.find(p=>p.id===selected)||pages[0];
 return <div className="app">
 <header><div className="brand"><ScanLine/> <span>Scanly</span></div><span className="badge">Offline scanner</span></header>
 <main>
 {!scanning&&!editing&&<><section className="hero"><div><p className="eyebrow">MULTI-PAGE DOCUMENT SCANNER</p><h1>Capture everything first. Edit afterward.</h1><p className="sub">Keep the camera open and scan multiple documents one after another. When you are done, crop and apply filters to every page before creating one PDF.</p><div className="actions"><button className="primary" onClick={openCamera}><Camera size={20}/> Start multi-document scan</button><label className="secondary"><ImageIcon size={19}/> Add multiple images<input type="file" accept="image/*" multiple onChange={upload}/></label></div></div><div className="hero-card"><FileText size={42}/><strong>Batch capture workflow</strong><span>Scan many pages, then edit them together.</span></div></section></>}
 {editing&&!scanning&&current&&<section className="editor">
   <div className="editor-head"><div><p className="eyebrow">EDIT SCANNED DOCUMENTS</p><h2>{pages.length} page{pages.length!==1?'s':''} captured</h2></div><div className="editor-actions"><button className="secondary small" onClick={openCamera}><Plus size={17}/> Capture more</button><button className="secondary small" onClick={()=>setEditing(false)}><ChevronLeft size={17}/> Back</button></div></div>
   <div className="editor-layout">
    <aside className="page-list">{pages.map((p,i)=><button className={'page-tab '+(p.id===selected?'active':'')} onClick={()=>setSelected(p.id)} key={p.id}><img src={p.src}/><span>Page {i+1}</span></button>)}</aside>
    <div className="preview-area"><div className="preview-frame"><img src={current.src} style={{filter:current.filter==='Grayscale'?'grayscale(1)':current.filter==='B&W'?'grayscale(1) contrast(2.5) brightness(1.12)':'none',transform:`translate(-${current.crop.x*(100/current.crop.w)}%,-${current.crop.y*(100/current.crop.h)}%) scale(${100/current.crop.w},${100/current.crop.h}) rotate(${current.rotation}deg)`}}/></div><span className="crop-note">Preview reflects crop and filter</span></div>
    <aside className="tools"><div className="tool-title"><Crop size={18}/> Crop all sides</div>
    <label>Left <b>{current.crop.x}%</b><input type="range" min="0" max={100-current.crop.w} value={current.crop.x} onChange={e=>setCrop('x',+e.target.value)}/></label>
    <label>Right <b>{100-current.crop.x-current.crop.w}%</b><input type="range" min="0" max={100-current.crop.w} value={100-current.crop.x-current.crop.w} onChange={e=>update(current.id,{crop:{...current.crop,w:100-current.crop.x-(+e.target.value)}})}/></label>
    <label>Top <b>{current.crop.y}%</b><input type="range" min="0" max={100-current.crop.h} value={current.crop.y} onChange={e=>setCrop('y',+e.target.value)}/></label>
    <label>Bottom <b>{100-current.crop.y-current.crop.h}%</b><input type="range" min="0" max={100-current.crop.h} value={100-current.crop.y-current.crop.h} onChange={e=>update(current.id,{crop:{...current.crop,h:100-current.crop.y-(+e.target.value)}})}/></label>
    <button className="reset-crop" onClick={()=>update(current.id,{crop:{...defaultCrop}})}><SlidersHorizontal size={16}/> Reset crop</button>
    <div className="tool-title">Filter</div><div className="filter-buttons">{filters.map(f=><button key={f} className={current.filter===f?'chosen':''} onClick={()=>update(current.id,{filter:f})}>{f}</button>)}</div>
    <button className="rotate-btn" onClick={()=>update(current.id,{rotation:(current.rotation+90)%360})}><RotateCw size={17}/> Rotate 90°</button>
    <button className="delete-btn" onClick={()=>{setPages(ps=>ps.filter(x=>x.id!==current.id));setSelected(pages.find(x=>x.id!==current.id)?.id??null)}}><Trash2 size={17}/> Delete page</button>
    </aside>
   </div>
   <div className="export"><div><label>PDF filename</label><input value={name} onChange={e=>setName(e.target.value)}/></div><button className="primary" onClick={makePdf}><Download size={19}/> Generate & Download PDF</button></div>
 </section>}
 {scanning&&<section className="camera"><div className="camera-top"><button onClick={()=>{stream.current?.getTracks().forEach(t=>t.stop());setScanning(false)}}><X/></button><div><span>Multi-document scan</span><small>{pages.length} captured{cameraInfo?` · ${cameraInfo}`:''}</small></div><button className="finish" disabled={!pages.length} onClick={finishCapture}><Check size={18}/> Finish</button></div><video ref={video} autoPlay playsInline muted/><div className="guide"/><div className="capture-bottom"><button className="shutter" onClick={capture}><span/></button><p>Capture each document. The camera stays open.</p></div></section>}
 </main><footer>Scanly · local-first multi-page document scanner</footer></div>
}
createRoot(document.getElementById('root')!).render(<App/>);
