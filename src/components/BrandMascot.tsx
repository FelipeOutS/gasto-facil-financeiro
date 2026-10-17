import { Link } from "@tanstack/react-router";

/** Original brand artwork; decorative when adjacent copy already explains the state. */
export function BrandMascot({
  pose = "apresentador",
  className = "",
}: {
  pose?: "apresentador" | "analitico";
  className?: string;
}) {
  return (
    <img
      src={`/mascote/${pose}.png`}
      alt=""
      aria-hidden="true"
      width={1024}
      height={1792}
      loading="lazy"
      decoding="async"
      className={`gi-mascot ${className}`}
    />
  );
}

export function DashboardGuide() {
  return (
    <aside className="gi-mascot-guide" aria-label="Organize seus próximos passos">
      <div>
        <p className="gi-guide-eyebrow">UM PASSO DE CADA VEZ</p>
        <h2>Seu próximo objetivo começa aqui.</h2>
        <p>Organize uma meta e acompanhe o que você já guardou.</p>
        <Link to="/metas">
          Explorar minhas metas <span aria-hidden="true">↗</span>
        </Link>
      </div>
      <BrandMascot />
    </aside>
  );
}
