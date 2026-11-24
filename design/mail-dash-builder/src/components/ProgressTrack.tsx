export function ProgressTrack({value,max,label,active=false,indeterminate=false}:{value:number;max:number;label:string;active?:boolean;indeterminate?:boolean}){
 const limit=Math.max(1,max),confirmed=Math.max(0,Math.min(limit,value));
 return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={indeterminate?undefined:confirmed} className="relay-progress-track" data-active={active} data-indeterminate={indeterminate}>
  <div aria-hidden="true" className="relay-progress-fill" style={{transform:indeterminate?undefined:`scaleX(${confirmed/limit})`}}/>
 </div>;
}
