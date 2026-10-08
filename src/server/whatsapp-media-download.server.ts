export function trustedMetaMediaUrl(raw:string):boolean {
  try {
    const url=new URL(raw);
    return url.protocol==="https:" && !url.username && !url.password && (!url.port || url.port==="443") &&
      (url.hostname==="lookaside.fbsbx.com" || url.hostname.endsWith(".fbcdn.net") || url.hostname.endsWith(".whatsapp.net"));
  } catch { return false; }
}
export async function readBoundedMedia(response:Response,maxBytes:number):Promise<Uint8Array|null> {
  const declared=Number(response.headers.get("content-length"));
  if(Number.isFinite(declared) && declared>maxBytes) {await response.body?.cancel();return null;}
  const reader=response.body?.getReader();if(!reader) return null;
  const chunks:Uint8Array[]=[];let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>maxBytes) {await reader.cancel();return null;}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const result=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}
  return result;
}
