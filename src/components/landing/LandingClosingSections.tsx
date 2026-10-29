import { motion } from "framer-motion";
import { useState, useEffect, useRef, type MouseEventHandler } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  LineChart,
  Mail,
  PencilLine,
  UserPlus,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import "./LandingClosingSections.css";

const groups = [
  { id: "start", questions: [0, 1, 11] },
  { id: "routine", questions: [2, 3, 4, 8] },
  { id: "access", questions: [9, 10] },
  { id: "business", questions: [5, 6, 7] },
] as const;

export function HowItWorks() {
  const { t } = useTranslation("landing");
  const icons = [UserPlus, PencilLine, LineChart];
  return (
    <section className="gi-journey" aria-labelledby="journey-title">
      <div className="gi-closing-inner">
        <header className="gi-journey-heading">
          <div>
            <p className="gi-closing-kicker">{t("closing.journey.kicker")}</p>
            <h2 id="journey-title">{t("closing.journey.title")}</h2>
          </div>
          <p>{t("closing.journey.lead")}</p>
        </header>
        <ol className="gi-journey-path">
          {icons.map((Icon, index) => (
            <li key={index}>
              <div className="gi-journey-marker">
                <span>0{index + 1}</span>
                <Icon size={23} aria-hidden="true" />
              </div>
              <div className="gi-journey-step">
                <h3>{t(`closing.journey.steps.${index}.title`)}</h3>
                <p>{t(`closing.journey.steps.${index}.text`)}</p>
                <span className="gi-journey-outcome">
                  <Check size={14} aria-hidden="true" />
                  {t(`closing.journey.steps.${index}.outcome`)}
                </span>
              </div>
            </li>
          ))}
        </ol>
        <div className="gi-journey-next">
          <p>{t("closing.journey.next")}</p>
          <Link to="/cadastro" className="gi-closing-link">
            {t("closing.journey.cta")}
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

export function FAQ() {
  const { t } = useTranslation("landing");
  const faqs = t("faq.items", { returnObjects: true }) as Array<{ q: string; a: string }>;
  const [keyboard, setKeyboard] = useState(false);
  const [categoryTransition, setCategoryTransition] = useState(false);
  const measureRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState<number>();
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    const observer = new ResizeObserver(([entry]) => setPanelHeight(entry.contentRect.height));
    if (measureRef.current) observer.observe(measureRef.current);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, []);

  const [open, setOpen] = useState<Record<string, string>>({
    start: "faq-0",
    routine: "faq-2",
    access: "faq-9",
    business: "faq-5",
  });
  return (
    <section id="duvidas" className="gi-clarity-faq" aria-labelledby="clarity-faq-title">
      <div className="gi-closing-inner">
        <header className="gi-faq-heading">
          <p className="gi-closing-kicker">{t("faq.eyebrow")}</p>
          <h2 id="clarity-faq-title">{t("faq.title")}</h2>
          <p>{t("closing.faq.lead")}</p>
        </header>
        <Tabs
          defaultValue="start"
          onValueChange={() => setCategoryTransition(true)}
          className="gi-faq-topics"
          onKeyDownCapture={() => setKeyboard(true)}
          onPointerDownCapture={() => setKeyboard(false)}
          data-keyboard={keyboard}
        >
          <TabsList aria-label={t("closing.faq.topics")} className="gi-faq-topic-list">
            {groups.map((group) => (
              <TabsTrigger value={group.id} key={group.id}>
                {t(`closing.faq.groups.${group.id}`)}
                <span aria-hidden="true">{group.questions.length}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          <motion.div
            className="gi-faq-panel-viewport"
            animate={{ height: panelHeight ?? "auto" }}
            transition={{
              duration: keyboard || reduced || !categoryTransition ? 0 : 0.22,
              ease: [0.23, 1, 0.32, 1],
            }}
          >
            <div ref={measureRef}>
              {groups.map((group) => (
                <TabsContent key={group.id} value={group.id} className="gi-faq-topic-panel">
                  <Accordion
                    type="single"
                    collapsible
                    value={open[group.id]}
                    onValueChange={(value) => {
                      setCategoryTransition(false);
                      setOpen((current) => ({ ...current, [group.id]: value }));
                    }}
                  >
                    {group.questions.map((index) => (
                      <AccordionItem key={index} value={`faq-${index}`} data-faq-item={index}>
                        <AccordionTrigger>{faqs[index].q}</AccordionTrigger>
                        <AccordionContent>{faqs[index].a}</AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </TabsContent>
              ))}
            </div>
          </motion.div>
        </Tabs>
        <div className="gi-faq-support">
          <div>
            <Mail size={19} aria-hidden="true" />
            <p>
              <strong>{t("closing.faq.more")}</strong>
              <span>{t("closing.faq.contactNote")}</span>
            </p>
          </div>
          <a href="mailto:contato@gastointeligente.com.br" className="gi-closing-link">
            {t("refinement.help")}
            <ArrowUpRight size={17} aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}

export function FinalCTA({ onPlans }: { onPlans: MouseEventHandler<HTMLAnchorElement> }) {
  const { t } = useTranslation("landing");
  return (
    <section id="comece-agora" className="gi-closing-cta" aria-labelledby="closing-cta-title">
      <div className="gi-closing-inner gi-closing-composition">
        <p className="gi-closing-kicker">{t("closing.cta.kicker")}</p>
        <h2 id="closing-cta-title">
          {t("closing.cta.title")} <span>{t("closing.cta.titleEnd")}</span>
        </h2>
        <div className="gi-closing-bottom">
          <p className="gi-closing-lead">{t("closing.cta.lead")}</p>
          <div className="gi-closing-actions">
            <Link to="/cadastro" className="gi-closing-primary">
              {t("finalCta.primary")}
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <a href="#planos" onClick={onPlans}>
              {t("finalCta.secondary")}
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
