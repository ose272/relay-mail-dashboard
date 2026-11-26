import {useEffect,useRef,useState} from 'react';
import './design-preview.css';
type Mode='desktop'|'mobile'|'responsive';
export function DesignPreview(){
 const initial=new URLSearchParams(location.search).get('view');
 const [mode,setMode]=useState<Mode>(initial==='mobile'||initial==='responsive'?initial:'desktop'),[fit,setFit]=useState(true),[available,setAvailable]=useState(1200);
 const canvas=useRef<HTMLDivElement>(null);
 useEffect(()=>{const element=canvas.current;if(!element)return;const update=()=>setAvailable(Math.max(280,element.clientWidth-32));update();const observer=new ResizeObserver(update);observer.observe(element);return()=>observer.disconnect();},[]);
 const width=mode==='desktop'?1440:mode==='mobile'?390:available,height=mode==='mobile'?844:1050,scale=fit?Math.min(1,available/width):1;
 const choose=(next:Mode)=>{setMode(next);setFit(true);const url=new URL(location.href);url.searchParams.set('view',next);history.replaceState({},'',url);};
 return <main className="design-preview"><header className="design-preview-toolbar"><div><strong>Sendar · Original design</strong><small>Device preview controls · Your interface is unchanged</small></div><div className="design-preview-controls" role="group" aria-label="Preview viewport"><button aria-pressed={mode==='desktop'} onClick={()=>choose('desktop')}>Desktop <span>1440 px</span></button><button aria-pressed={mode==='mobile'} onClick={()=>choose('mobile')}>Mobile <span>390 px</span></button><button aria-pressed={mode==='responsive'} onClick={()=>choose('responsive')}>Responsive</button></div><button className="design-preview-zoom" aria-pressed={!fit} onClick={()=>setFit(v=>!v)}>{fit?'Fit · '+Math.round(scale*100)+'%':'Actual size · 100%'}</button></header><div ref={canvas} className="design-preview-canvas"><div className="design-preview-frame" style={{width:width*scale,height:height*scale}}><iframe title={mode==='desktop'?'Sendar desktop design':mode==='mobile'?'Sendar mobile design':'Sendar responsive design'} src="/sendar/design?frame=1" style={{width,height,transform:`scale(${scale})`}}/></div></div></main>;
}
