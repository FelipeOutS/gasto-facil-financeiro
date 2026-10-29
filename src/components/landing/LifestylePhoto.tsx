import { motion, useReducedMotion } from "framer-motion";
import "./lifestyle-photo.css";

/** Supporting photography only: content and actions stay outside the image. */
export function LifestylePhoto({ src, smallSrc, alt, className = "" }: {
  src: string; smallSrc: string; alt: string; className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.figure
      className={`gi-lifestyle-photo ${className}`}
      initial={reduce ? false : { opacity: 0, transform: "translateY(10px)" }}
      whileInView={{ opacity: 1, transform: "translateY(0px)" }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: reduce ? 0 : 0.45, ease: [0.23, 1, 0.32, 1] }}
    >
      <img src={src} srcSet={`${smallSrc} 640w, ${src} 1280w`}
        sizes="(min-width: 1024px) 560px, (min-width: 768px) calc(100vw - 48px), calc(100vw - 32px)"
        width={1672} height={941} alt={alt} loading="lazy" decoding="async" />
    </motion.figure>
  );
}
