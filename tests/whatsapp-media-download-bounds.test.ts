import {test,expect} from "bun:test";
import {readBoundedMedia,trustedMetaMediaUrl} from "../src/server/whatsapp-media-download.server";
test("allowlisted HTTPS hosts only; no token redirect target",()=>{
  expect(trustedMetaMediaUrl("https://lookaside.fbsbx.com/whatsapp_business/attachments/test")).toBe(true);
  for(const url of ["http://lookaside.fbsbx.com/test","https://lookaside.fbsbx.com.attacker.test/test","https://user:pass@lookaside.fbsbx.com/test","https://127.0.0.1/test"])
    expect(trustedMetaMediaUrl(url)).toBe(false);
});
test("stream stops at budget, even without content length",async()=>{
  let cancelled=false;
  const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(10));c.enqueue(new Uint8Array(10));},cancel(){cancelled=true;}});
  expect(await readBoundedMedia(new Response(stream),15)).toBeNull();
  expect(cancelled).toBe(true);
  expect((await readBoundedMedia(new Response(new Uint8Array(10)),15))?.byteLength).toBe(10);
});
