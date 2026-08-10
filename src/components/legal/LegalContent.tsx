import { Trans, useTranslation } from "react-i18next";

/**
 * Conteúdo jurídico dos Termos de Uso.
 * Fonte ÚNICA: usado pela rota pública `/termos` e pela rota interna
 * `/app/ajustes/ajuda/termos`. Somente o layout muda entre os contextos.
 */
export function TermosContent() {
  const { t } = useTranslation("legal");
  return (
    <>
      <p>
        <Trans i18nKey="termos.intro" ns="legal" components={[<strong key="0" />]} />
      </p>

      <h2>{t("termos.s1.h")}</h2>
      <p>{t("termos.s1.p1")}</p>
      <p>
        <Trans i18nKey="termos.s1.p2" ns="legal" components={[<strong key="0" />]} />
      </p>

      <h2>{t("termos.s2.h")}</h2>
      <ul>
        <li>{t("termos.s2.i1")}</li>
        <li>{t("termos.s2.i2")}</li>
        <li>{t("termos.s2.i3")}</li>
      </ul>

      <h2>{t("termos.s3.h")}</h2>
      <p>{t("termos.s3.p")}</p>

      <h2>{t("termos.s4.h")}</h2>
      <p>{t("termos.s4.p")}</p>

      <h2>{t("termos.s5.h")}</h2>
      <p>{t("termos.s5.p")}</p>

      <h2>{t("termos.s6.h")}</h2>
      <p>{t("termos.s6.p")}</p>

      <h2>{t("termos.s7.h")}</h2>
      <p>
        <Trans
          i18nKey="termos.s7.p"
          ns="legal"
          components={[<a key="0" href="mailto:contato@gastointeligente.com.br" />]}
        />
      </p>
    </>
  );
}

/**
 * Conteúdo jurídico da Política de Privacidade.
 * Fonte ÚNICA: rota pública `/privacidade` e rota interna
 * `/app/ajustes/ajuda/privacidade`.
 */
export function PrivacidadeContent() {
  const { t } = useTranslation("legal");
  return (
    <>
      <p>
        <Trans i18nKey="privacidade.intro" ns="legal" components={[<strong key="0" />]} />
      </p>

      <h2>{t("privacidade.s1.h")}</h2>
      <ul>
        <li>
          <strong>{t("privacidade.s1.i1Strong")}</strong> {t("privacidade.s1.i1")}
        </li>
        <li>
          <strong>{t("privacidade.s1.i2Strong")}</strong> {t("privacidade.s1.i2")}
        </li>
        <li>
          <strong>{t("privacidade.s1.i3Strong")}</strong> {t("privacidade.s1.i3")}
        </li>
      </ul>

      <h2>{t("privacidade.s2.h")}</h2>
      <ul>
        <li>{t("privacidade.s2.i1")}</li>
        <li>{t("privacidade.s2.i2")}</li>
        <li>{t("privacidade.s2.i3")}</li>
        <li>{t("privacidade.s2.i4")}</li>
      </ul>

      <h2>{t("privacidade.s3.h")}</h2>
      <p>{t("privacidade.s3.p")}</p>

      <h2>{t("privacidade.s4.h")}</h2>
      <p>{t("privacidade.s4.p")}</p>

      <h2>{t("privacidade.s5.h")}</h2>
      <ul>
        <li>{t("privacidade.s5.i1")}</li>
        <li>{t("privacidade.s5.i2")}</li>
        <li>{t("privacidade.s5.i3")}</li>
      </ul>

      <h2>{t("privacidade.s6.h")}</h2>
      <p>{t("privacidade.s6.p")}</p>

      <h2>{t("privacidade.s7.h")}</h2>
      <p>
        <Trans
          i18nKey="privacidade.s7.p"
          ns="legal"
          components={[<a key="0" href="mailto:contato@gastointeligente.com.br" />]}
        />
      </p>
    </>
  );
}
