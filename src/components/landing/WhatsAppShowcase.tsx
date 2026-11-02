import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  CheckCheck,
  MessageCircle,
  Pause,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import "./WhatsAppShowcase.css";

export const WHATSAPP_DEMO_DURATION = 13000;
export function whatsappDemoPhase(time: number) {
  if (time < 700) return "intro";
  if (time < 2300) return "typing";
  if (time < 3000) return "sent";
  if (time < 4200) return "processing";
  if (time < 6500) return "review";
  if (time < 7800) return "confirming";
  if (time < 12500) return "complete";
  return "reset";
}

/** Illustrative, local-only timeline. No input, network client or financial action. */
export function WhatsAppShowcase() {
  const { t } = useTranslation("landing");
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const elapsed = useRef(0);
  const [time, setTime] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReduced(media.matches);
    const syncVisibility = () => setForeground(!document.hidden);
    syncMotion();
    syncVisibility();
    media.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    // Observe the phone rather than the whole two-column section on short screens.
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0,
    });
    if (root.current) observer.observe(root.current);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);
  const running = visible && foreground && !paused && !reduced;
  useEffect(() => {
    if (!running) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      // Never skip a scene after a suspended/overloaded browser resumes.
      elapsed.current += Math.min(now - previous, 150);
      previous = now;
      if (elapsed.current >= WHATSAPP_DEMO_DURATION) {
        elapsed.current %= WHATSAPP_DEMO_DURATION;
        setCycle((value) => value + 1);
      }
      setTime(elapsed.current);
    }, 50);
    return () => window.clearInterval(timer);
  }, [running]);
  const shownTime = reduced ? 10000 : time;
  const phase = whatsappDemoPhase(shownTime);
  const sent = shownTime >= 2300;
  const reviewed = shownTime >= 4200;
  const confirmed = shownTime >= 7800;
  const message = t("showcase.message");
  const typed =
    phase === "typing"
      ? message.slice(0, Math.ceil(((shownTime - 700) / 1600) * message.length))
      : "";
  const restart = () => {
    elapsed.current = 0;
    setTime(0);
    setCycle((value) => value + 1);
  };
  return (
    <div
      ref={root}
      className="gi-wa-showcase"
      data-phase={phase}
      data-running={running}
      data-cycle={cycle}
      data-reduced={reduced}
    >
      <p id={`${id}-description`} className="sr-only">
        {t("showcase.description")}
      </p>
      <div className="gi-wa-phone" aria-hidden="true">
        <div className="gi-wa-hardware">
          <span>9:41</span>
          <i />
          <span>▰</span>
        </div>
        <div className="gi-wa-header">
          <span className="gi-wa-avatar">
            <BrandMark variant="symbol" appearance="light" decorative className="h-8 w-8" />
          </span>
          <div>
            <strong>Gasto Inteligente</strong>
            <small>{t("showcase.preview")}</small>
          </div>
          <ShieldCheck size={19} />
        </div>
        <div className="gi-wa-conversation" key={cycle} data-reset={phase === "reset"}>
          <span className="gi-wa-day">{t("showcase.today")}</span>
          <div className="gi-wa-intro" data-visible={!sent}>
            <MessageCircle size={26} />
            <strong>{t("showcase.start")}</strong>
            <span>{t("showcase.startNote")}</span>
          </div>
          <div className="gi-wa-message gi-wa-outgoing" data-visible={sent}>
            {message}
            <small>
              9:41 <CheckCheck size={13} />
            </small>
          </div>
          <div className="gi-wa-processing" data-visible={phase === "processing"}>
            <span className="gi-wa-dots">
              <i />
              <i />
              <i />
            </span>
            {t("showcase.processing")}
          </div>
          <div className="gi-wa-message gi-wa-review" data-visible={reviewed}>
            <p>{t("showcase.found")}</p>
            <div className="gi-wa-amount">
              <strong>Uber</strong>
              <b>R$ 35,00</b>
            </div>
            <dl>
              <div>
                <dt>{t("showcase.category")}</dt>
                <dd>{t("showcase.transport")}</dd>
              </div>
              <div>
                <dt>{t("showcase.date")}</dt>
                <dd>{t("showcase.today")}</dd>
              </div>
            </dl>
            <p className="gi-wa-question">{t("showcase.question")}</p>
            <div
              className="gi-wa-simulated"
              data-confirming={phase === "confirming"}
              data-confirmed={confirmed}
            >
              <Check size={15} />
              {confirmed
                ? t("showcase.confirmed")
                : phase === "confirming"
                  ? t("showcase.saving")
                  : t("showcase.confirm")}
            </div>
            <div className="gi-wa-alternatives">
              <span>{t("showcase.adjust")}</span>
              <span>{t("showcase.cancel")}</span>
            </div>
          </div>
          <div className="gi-wa-message gi-wa-success" data-visible={confirmed}>
            <span className="gi-wa-check">
              <Check size={17} />
            </span>
            <div>
              <strong>{t("showcase.done")}</strong>
              <p>{t("showcase.saved")}</p>
              <small>9:42</small>
            </div>
          </div>
        </div>
        <div className="gi-wa-composer">
          <div>
            {typed || <span>{t("showcase.input")}</span>}
            {phase === "typing" && <i />}
          </div>
          <span className="gi-wa-send" data-ready={phase === "typing"}>
            <Send size={18} />
          </span>
        </div>
        <div className="gi-wa-home" />
      </div>
      <div
        className="gi-wa-controls"
        role="group"
        aria-label={t("showcase.controls")}
        aria-describedby={`${id}-description`}
      >
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          disabled={reduced}
          aria-label={paused ? t("showcase.play") : t("showcase.pause")}
          aria-pressed={paused}
        >
          {paused || reduced ? <Play size={16} /> : <Pause size={16} />}
          <span>
            {reduced
              ? t("showcase.static")
              : paused
                ? t("showcase.playShort")
                : t("showcase.pauseShort")}
          </span>
        </button>
        <span className="gi-wa-step" aria-hidden="true">
          {t(`showcase.phases.${phase}`)}
        </span>
        <button
          type="button"
          onClick={restart}
          disabled={reduced}
          aria-label={t("showcase.restart")}
        >
          <RotateCcw size={17} />
        </button>
      </div>
      <p className="gi-wa-caption">{t("showcase.caption")}</p>
    </div>
  );
}
