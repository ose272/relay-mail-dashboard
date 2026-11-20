/** Remove embedded reply history for display; original mail stays unchanged. */
export function messageTextOnly(value: string = ''): string {
 const lines=String(value).replace(/\r\n?/g,'\n').split('\n'),kept:string[]=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  if(/^\s*(?:-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}|Begin forwarded message:)\s*$/i.test(line))break;
  if(/^\s*From:\s*\S/i.test(line)){
   const headers=lines.slice(i,i+9).join('\n');
   if(/^\s*(?:Sent|Date):/im.test(headers) && /^\s*To:/im.test(headers) && /^\s*Subject:/im.test(headers))break;
  }
  if(/^\s*(?:On\s|Le\s|Am\s)/i.test(line)){
   let end=i;while(end<Math.min(lines.length,i+6) && !/(?:wrote:|a écrit\s*:|schrieb.*:)\s*$/i.test(lines[end]))end++;
   const header=lines.slice(i,end+1).join(' ');
   if(end<Math.min(lines.length,i+6) && /@|\b(?:19|20)\d{2}\b|\b\d{1,2}:\d{2}\b|\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),/i.test(header)){
    if(!lines.slice(end+1).some(l=>/^\s*>/.test(l)))break;
    i=end;continue;
   }
  }
  if(/^\s*>/.test(line))continue;
  kept.push(line);
 }
 return kept.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
