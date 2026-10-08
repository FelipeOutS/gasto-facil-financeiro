/**
 * GI Agenda — datas/horários em fuso do usuário.
 *
 * Regra: o banco guarda instantes em UTC (`starts_at`) e o item guarda o
 * fuso IANA (`timezone`). Tudo que a pessoa diz ("amanhã às 9") é
 * interpretado no fuso dela e convertido para UTC. Nada aqui assume
 * São Paulo além do valor padrão.
 */
export const DEFAULT_TZ = "America/Sao_Paulo";

export type YMD = { y: number; m: number; d: number };
export type HM = { h: number; mi: number };

function parts(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** Data/hora local (no fuso) de um instante. */
export function localParts(date: Date, tz: string = DEFAULT_TZ): YMD & HM & { dow: number } {
  const p = parts(date, tz);
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour) % 24,
    mi: Number(p.minute),
    dow: dows.indexOf(p.weekday),
  };
}

/** Offset (ms) do fuso num instante: local - UTC. */
function offsetMs(date: Date, tz: string): number {
  const p = parts(date, tz);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converte data/hora local (no fuso) para instante UTC. Seguro em DST. */
export function localToUtc(ymd: YMD, hm: HM, tz: string = DEFAULT_TZ): Date {
  const guess = Date.UTC(ymd.y, ymd.m - 1, ymd.d, hm.h, hm.mi, 0);
  let t = guess - offsetMs(new Date(guess), tz);
  // Segunda passada corrige transições de horário de verão.
  t = guess - offsetMs(new Date(t), tz);
  return new Date(t);
}

export function addDaysYmd(ymd: YMD, days: number): YMD {
  const dt = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function ymdToIso(ymd: YMD): string {
  return `${ymd.y}-${String(ymd.m).padStart(2, "0")}-${String(ymd.d).padStart(2, "0")}`;
}

export function isoToYmd(iso: string): YMD {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

export function cmpYmd(a: YMD, b: YMD): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

export function diffDaysYmd(a: YMD, b: YMD): number {
  return Math.round(
    (Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86_400_000,
  );
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

export type ParsedWhen = {
  /** Data local (fuso do usuário), se mencionada. */
  date: YMD | null;
  /** Horário local, se mencionado. */
  time: HM | null;
  /** Instante absoluto (só para "daqui N horas/minutos"). */
  instant: Date | null;
  /** Texto restante (normalizado) sem os trechos de data/hora. */
  rest: string;
};

/**
 * Interpreta data e horário em português, relativos a `now` no fuso `tz`.
 * Não confunde valores ("pagar 50") com horário: horário exige "h", ":",
 * "às" ou "da manhã/tarde/noite".
 */
export function parseWhen(text: string, now: Date, tz: string = DEFAULT_TZ): ParsedWhen {
  let s = ` ${norm(text).replace(/[?!.,;]+(\s|$)/g, " ")} `.replace(/\s+/g, " ");
  const spoken: Record<string, number> = { uma: 1, um: 1, duas: 2, dois: 2, tres: 3,
    quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
    onze: 11, doze: 12, treze: 13, quatorze: 14, quinze: 15, dezesseis: 16,
    dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20 };
  // Only convert within explicit temporal markers; money/title stay intact.
  s = s.replace(/\b(as|dia|daqui a|daqui|em) ([a-z]+)(?=\s)/g,
    (all, marker: string, word: string) => spoken[word] == null ? all : `${marker} ${spoken[word]}`);
  const today = localParts(now, tz);
  const todayYmd: YMD = { y: today.y, m: today.m, d: today.d };
  let date: YMD | null = null;
  let time: HM | null = null;
  let instant: Date | null = null;
  const cut = (re: RegExp) => {
    s = s.replace(re, " ").replace(/\s+/g, " ");
  };

  // Relativo absoluto: "daqui 2 horas", "daqui a 30 minutos", "em 2 horas"
  const rel = /\s(?:daqui(?: a)?|em|dentro de)\s(\d{1,3}|uma|um|meia)\s(horas?|h|minutos?|min|dias?)\s/.exec(s);
  if (rel) {
    const n = rel[1] === "uma" || rel[1] === "um" ? 1 : rel[1] === "meia" ? 0.5 : Number(rel[1]);
    const unit = rel[2];
    if (unit.startsWith("d")) {
      date = addDaysYmd(todayYmd, Math.round(n));
    } else {
      const ms = unit.startsWith("h") ? n * 3600_000 : n * 60_000;
      instant = new Date(now.getTime() + ms);
    }
    cut(new RegExp(rel[0].trim().replace(/\s/g, "\\s")));
  }

  // Datas explícitas
  let m: RegExpExecArray | null;
  if (!date && (m = /\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s/.exec(s))) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : today.y;
    if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)) {
      date = { y, m: mo, d };
      if (!m[3] && cmpYmd(date, todayYmd) < 0) date = { y: y + 1, m: mo, d };
      cut(/\s(?:no |em |dia )?\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s/);
    }
  }
  if (!date && /\sdepois de amanha\s/.test(s)) {
    date = addDaysYmd(todayYmd, 2);
    cut(/\sdepois de amanha\s/);
  }
  if (!date && /\samanha\s/.test(s)) {
    date = addDaysYmd(todayYmd, 1);
    cut(/\s(?:de |para |pra )?amanha\s/);
  }
  if (!date && /\shoje\s/.test(s)) {
    date = todayYmd;
    cut(/\s(?:de |para |pra )?hoje\s/);
  }
  if (!date && (m = /\s(?:(?:na|no|nesta|neste|nessa|esta|essa|proxima|proximo)\s)*(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira| feira)?\s/.exec(s))) {
    const target = WEEKDAYS[m[1]];
    let delta = (target - today.dow + 7) % 7;
    if (delta === 0) delta = 7;
    date = addDaysYmd(todayYmd, delta);
    cut(new RegExp(m[0].trim().replace(/\s/g, "\\s")));
  }
  if (!date && (m = /\s(?:no )?dia (\d{1,2})\s/.exec(s))) {
    const d = Number(m[1]);
    if (d >= 1 && d <= 31) {
      let y = today.y;
      let mo = today.m;
      if (d < today.d) {
        mo += 1;
        if (mo > 12) {
          mo = 1;
          y += 1;
        }
      }
      while (d > daysInMonth(y, mo)) {
        mo += 1;
        if (mo > 12) {
          mo = 1;
          y += 1;
        }
      }
      date = { y, m: mo, d };
      cut(/\s(?:no )?dia \d{1,2}\s/);
    }
  }

  // Horários
  if ((m = /\s(?:as |a )?meio[- ]dia\s/.exec(s))) {
    time = { h: 12, mi: 0 };
    cut(/\s(?:as |a )?meio[- ]dia\s/);
  } else if ((m = /\s(?:as |a )?(\d{1,2})(?::(\d{2})|h(\d{2})?)?(?: horas?)? da (manha|tarde|noite|madrugada)\s/.exec(s))) {
    let h = Number(m[1]);
    const mi = Number(m[2] ?? m[3] ?? 0);
    const per = m[4];
    if ((per === "tarde" || per === "noite") && h < 12) h += 12;
    if (h === 12 && (per === "manha" || per === "madrugada" || per === "noite")) h = 0;
    if (h <= 23 && mi <= 59) time = { h, mi };
    cut(new RegExp(m[0].trim().replace(/\s/g, "\\s")));
  } else if ((m = /\s(?:as |a )?(\d{1,2}):(\d{2})(?:h)?\s/.exec(s))) {
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h <= 23 && mi <= 59) {
      time = { h, mi };
      cut(new RegExp(m[0].trim().replace(/\s/g, "\\s")));
    }
  } else if ((m = /\s(?:as |a )?(\d{1,2})h(\d{2})?(?:min)?\s/.exec(s))) {
    const h = Number(m[1]);
    const mi = Number(m[2] ?? 0);
    if (h <= 23 && mi <= 59) {
      time = { h, mi };
      cut(new RegExp(m[0].trim().replace(/\s/g, "\\s")));
    }
  } else if ((m = /\sas (\d{1,2})(?: horas?)?\s/.exec(s))) {
    const h = Number(m[1]);
    if (h <= 23) {
      time = { h, mi: 0 };
      cut(new RegExp(m[0].trim().replace(/\s/g, "\\s")));
    }
  }

  return { date, time, instant, rest: s.trim() };
}

/**
 * Resolve um ParsedWhen num instante UTC. Sem horário → `defaultTime`.
 * Sem data mas com horário: hoje, ou amanhã se o horário já passou.
 */
export function resolveWhen(
  w: ParsedWhen,
  now: Date,
  tz: string = DEFAULT_TZ,
  defaultTime: HM = { h: 9, mi: 0 },
): Date | null {
  if (w.instant) return w.instant;
  if (!w.date && !w.time) return null;
  const lp = localParts(now, tz);
  const today: YMD = { y: lp.y, m: lp.m, d: lp.d };
  let date = w.date ?? today;
  const time = w.time ?? defaultTime;
  let at = localToUtc(date, time, tz);
  if (!w.date && at.getTime() <= now.getTime()) {
    date = addDaysYmd(today, 1);
    at = localToUtc(date, time, tz);
  }
  return at;
}

/** "sex., 02/10 às 14:00" no fuso do item. */
export function formatWhen(iso: string | Date, tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const lp = localParts(d, tz);
  const today = localParts(now, tz);
  const diff = diffDaysYmd(lp, today);
  const hm = `${String(lp.h).padStart(2, "0")}:${String(lp.mi).padStart(2, "0")}`;
  const dm = `${String(lp.d).padStart(2, "0")}/${String(lp.m).padStart(2, "0")}`;
  if (diff === 0) return `Hoje às ${hm}`;
  if (diff === 1) return `Amanhã às ${hm}`;
  const wd = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][lp.dow];
  const yr = lp.y !== today.y ? `/${lp.y}` : "";
  return `${wd}, ${dm}${yr} às ${hm}`;
}
