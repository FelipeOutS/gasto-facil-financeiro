import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Smartphone, Target, TrendingUp, Wallet } from "lucide-react";
import "./RealMobileShowcase.css";
const screens = ["dashboard", "metas", "investimentos", "guardado"] as const;
const icons = [Smartphone, Target, TrendingUp, Wallet];
const imageFor = (index: number) =>
  `/images/landing/mobile/gasto-inteligente-mobile-${screens[index]}.webp`;
const decoded = new Map<string, Promise<void>>();
function prepare(index: number) {
  const src = imageFor(index);
  if (!decoded.has(src)) {
    const image = new Image();
    image.src = src;
    decoded.set(
      src,
      image.decode().catch((error) => {
        decoded.delete(src);
        throw error;
      }),
    );
  }
  return decoded.get(src)!;
}

/** Real application captures. The same grid cell measures every copy panel without exposing inactive content. */
export function RealMobileShowcase() {
  const { t } = useTranslation("landing");
  const [selected, setSelected] = useState(0),
    [displayed, setDisplayed] = useState(0);
  const [phase, setPhase] = useState("idle"),
    [error, setError] = useState(false),
    [reduce, setReduce] = useState(false);
  const generation = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduce(m.matches);
    sync();
    m.addEventListener("change", sync);
    return () => {
      m.removeEventListener("change", sync);
      generation.current++;
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (reduce) setPhase("idle");
  }, [reduce]);
  async function select(index: number, instant = false) {
    const version = ++generation.current;
    clearTimeout(timer.current);
    setSelected(index);
    setError(false);
    setPhase("idle");
    try {
      await prepare(index);
    } catch {
      if (version === generation.current) {
        setError(true);
        setSelected(displayed);
      }
      return;
    }
    if (version !== generation.current) return;
    if (instant || reduce || index === displayed) {
      setDisplayed(index);
      setPhase("idle");
      return;
    }
    setPhase("leaving");
    timer.current = setTimeout(() => {
      if (version !== generation.current) return;
      setDisplayed(index);
      setPhase("entering");
      timer.current = setTimeout(() => {
        if (version === generation.current) setPhase("idle");
      }, 180);
    }, 100);
  }
  return (
    <section id="demonstracoes" className="gi-real-mobile" aria-labelledby="real-mobile-title">
      <div className="gi-real-mobile-inner">
        <header className="gi-real-mobile-heading">
          <p className="gi-real-eyebrow">{t("realMobile.eyebrow")}</p>
          <h2 id="real-mobile-title">{t("refinement.demoTitle")}</h2>
          <p>{t("realMobile.intro")}</p>
        </header>
        <div className="gi-real-tabs" role="tablist" aria-label={t("refinement.demoTitle")}>
          {screens.map((screen, index) => {
            const Icon = icons[index];
            return (
              <button
                key={screen}
                type="button"
                role="tab"
                id={`real-mobile-tab-${index}`}
                aria-controls={`real-mobile-panel-${index}`}
                aria-selected={selected === index}
                tabIndex={selected === index ? 0 : -1}
                onPointerEnter={() => void prepare(index).catch(() => {})}
                onFocus={() => void prepare(index).catch(() => {})}
                onClick={(e) => void select(index, e.detail === 0)}
                onKeyDown={(e) => {
                  const next =
                    e.key === "ArrowRight"
                      ? (index + 1) % 4
                      : e.key === "ArrowLeft"
                        ? (index + 3) % 4
                        : e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? 3
                            : null;
                  if (next === null) return;
                  e.preventDefault();
                  void select(next, true);
                  document
                    .getElementById(`real-mobile-tab-${next}`)
                    ?.focus({ preventScroll: true });
                }}
              >
                <Icon size={17} aria-hidden="true" />
                {t(`realMobile.${screen}.label`)}
              </button>
            );
          })}
        </div>
        <div className="gi-real-stage" data-phase={reduce ? "idle" : phase}>
          <figure id="app-mobile" className="gi-real-device-area">
            <div className="gi-real-device">
              <img
                src={imageFor(displayed)}
                width={780}
                height={1688}
                loading="lazy"
                decoding="async"
                alt={t(`realMobile.${screens[displayed]}.alt`)}
              />
            </div>
            <figcaption>
              <span aria-hidden="true" />
              {t("realMobile.caption")}
            </figcaption>
          </figure>
          <div className="gi-real-copy-stack">
            {screens.map((screen, index) => (
              <div
                key={screen}
                id={`real-mobile-panel-${index}`}
                role="tabpanel"
                aria-labelledby={`real-mobile-tab-${index}`}
                tabIndex={0}
                aria-hidden={displayed !== index}
                inert={displayed !== index}
                className={`gi-real-copy ${displayed === index ? "is-active" : ""}`}
              >
                <p className="gi-real-step">0{index + 1} / 04</p>
                <h3>{t(`realMobile.${screen}.title`)}</h3>
                <p className="gi-real-description">{t(`realMobile.${screen}.description`)}</p>
                <ul>
                  {[0, 1, 2].map((i) => (
                    <li key={i}>
                      <Check size={18} aria-hidden="true" />
                      <span>{t(`realMobile.${screen}.benefits.${i}`)}</span>
                    </li>
                  ))}
                </ul>
                <p className="gi-real-note">{t("realMobile.note")}</p>
                <a href="#planos" className="gi-real-cta">
                  {t("realMobile.cta")}
                  <ArrowRight size={18} aria-hidden="true" />
                </a>
              </div>
            ))}
          </div>
        </div>
        {error && <p role="status">{t("realMobile.error")}</p>}
      </div>
    </section>
  );
}
