import { describe, test, expect, afterEach } from "bun:test";
import { detectRecurrence, stripRecurrence, nextOccurrence } from "../src/lib/agenda/recurrence";
import { parseWhen, resolveWhen } from "../src/lib/agenda/datetime";
import { transcribeWhatsAppAudio, TRANSCRIPTION_MAX_RESPONSE_BYTES, TRANSCRIPTION_TIMEOUT_MS } from "../src/server/whatsapp-transcription.server";
import {splitAudioInstructions} from "../src/server/whatsapp-audio-intents.server";
import {detectAgendaIntent} from "../src/lib/agenda/intent";

const now = new Date("2026-10-07T13:00:00Z");
const fetchBefore = globalThis.fetch;
const keyBefore = process.env.LOVABLE_API_KEY;
afterEach(() => {
  globalThis.fetch = fetchBefore;
  if (keyBefore === undefined) delete process.env.LOVABLE_API_KEY;
  else process.env.LOVABLE_API_KEY = keyBefore;
});
describe("reminder temporal foundation", () => {
  test("recurrence prefix and conversational management",()=> {
    const item=detectAgendaIntent("Todo dia 5, às 8 horas, me lembra de pagar o aluguel.");
    expect(item?.type).toBe("criar");
    if(item?.type==="criar") expect(item.recurrence).toBe("mensal");
    expect(detectAgendaIntent("Quais lembretes tenho para amanhã?")).toEqual({type:"consultar",periodo:"amanha"});
    expect(detectAgendaIntent("Não precisa mais me lembrar de pagar essa conta.")?.type).toBe("cancelar");
  });
  test("four independent utterances, no financial extraction or inherited date",()=>{
    expect(splitAudioInstructions("Ontem eu gastei 85 reais no mercado pelo Nubank. Também recebi 2.300 reais do meu salário. Ah, a conta de luz eu já paguei hoje, e me lembra de pagar a internet no dia 15 às nove da manhã.")).toHaveLength(4);
    expect(splitAudioInstructions("gastei 85 reais. Não, oitenta reais no mercado em três parcelas")).toHaveLength(1);
  });
  test("numbered day is monthly and survives stripping", () => {
    expect(detectRecurrence("todo dia 5 as 8" )).toBe("mensal");
    expect(stripRecurrence("todo dia 5 as 8")).toBe("dia 5 as 8");
    expect(detectRecurrence("todo dia as 8")).toBe("diaria");
  });
  test("spoken temporal numbers preserve the description", () => {
    const w = parseWhen("daqui a duas horas de ligar para o contador", now);
    expect(w.instant?.toISOString()).toBe("2026-10-07T15:00:00.000Z");
    expect(w.rest).toBe("de ligar para o contador");
    expect(resolveWhen(parseWhen("amanha as nove da manha", now), now)?.toISOString())
      .toBe("2026-10-08T12:00:00.000Z");
    expect(parseWhen("amanha as 12 da noite",now).time).toEqual({h:0,mi:0});
  });
  test("monthly short month returns to anchor day", () => {
    const anchor = new Date("2026-01-31T11:00:00Z");
    expect(nextOccurrence(anchor, {freq:"mensal"}, anchor)?.toISOString()).toBe("2026-02-28T11:00:00.000Z");
    expect(nextOccurrence(anchor, {freq:"mensal"}, new Date("2026-03-01T00:00:00Z"))?.toISOString()).toBe("2026-03-31T11:00:00.000Z");
  });
});
describe("bounded transcription without real network", () => {
  const audio = new Uint8Array([1,2,3]);
  test("provider unavailable fails closed", async () => {
    delete process.env.LOVABLE_API_KEY;
    expect(await transcribeWhatsAppAudio(audio,"audio/ogg")).toEqual({ok:false,reason:"unavailable"});
  });
  test("request carries abort signal and Portuguese language", async () => {
    process.env.LOVABLE_API_KEY="test-only";
    globalThis.fetch = (async (_url, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect((init?.body as FormData).get("language")).toBe("pt");
      return Response.json({text:"me lembra amanhã às nove",language:"pt"});
    }) as typeof fetch;
    expect((await transcribeWhatsAppAudio(audio,"audio/ogg")).ok).toBe(true);
  });
  test("silence and corrupt provider JSON fail safely", async () => {
    process.env.LOVABLE_API_KEY="test-only";
    globalThis.fetch=(async()=>Response.json({text:" "})) as typeof fetch;
    expect(await transcribeWhatsAppAudio(audio,"audio/ogg")).toEqual({ok:false,reason:"empty"});
    globalThis.fetch=(async()=>new Response("invalid")) as typeof fetch;
    expect((await transcribeWhatsAppAudio(audio,"audio/ogg")).ok).toBe(false);
  });
  test("response memory budget enforced", async () => {
    process.env.LOVABLE_API_KEY="test-only";
    globalThis.fetch=(async()=>new Response("x".repeat(TRANSCRIPTION_MAX_RESPONSE_BYTES+1))) as typeof fetch;
    expect((await transcribeWhatsAppAudio(audio,"audio/ogg")).ok).toBe(false);
  });
  test("provider timeout aborts without leaking content or creating actions",async()=>{
    process.env.LOVABLE_API_KEY="test-only";
    globalThis.fetch=((_url,init)=>new Promise((_resolve,reject)=>{
      init?.signal?.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true});
    })) as typeof fetch;
    expect(await transcribeWhatsAppAudio(audio,"audio/ogg")).toEqual({ok:false,reason:"failed"});
  },TRANSCRIPTION_TIMEOUT_MS+5000);
});
