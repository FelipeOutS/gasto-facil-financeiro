import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { countToday } from "@/lib/agenda/buckets";

/** Só LÊ a Agenda (fonte única). Não cria alertas próprios. */
export function AgendaTodayHint({ onClose }: { onClose?: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase
        .from("agenda_items")
        .select("status, starts_at, timezone")
        .eq("status", "ativo")
        .not("starts_at", "is", null)
        .lte("starts_at", new Date(Date.now() + 36 * 3600_000).toISOString())
        .limit(200);
      if (alive) setN(countToday(data ?? [], new Date()));
    })();
    return () => {
      alive = false;
    };
  }, []);
  if (!n) return null;
  return (
    <Link
      to="/agenda"
      onClick={onClose}
      className="flex items-center gap-2 border-b border-border/40 px-4 py-2.5 text-xs font-semibold text-primary hover:bg-accent"
    >
      <CalendarClock className="h-4 w-4" />
      {n === 1 ? "Você tem 1 item na agenda hoje" : `Você tem ${n} itens na agenda hoje`}
    </Link>
  );
}
