import { SECURITY_HEADERS } from "./security-headers.server";

/**
 * Hook global para o Nitro injetar cabeçalhos de segurança em todas as respostas.
 * TanStack Start v1 roda sobre Nitro; o hook 'render:response' captura todas as saídas HTML/API.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response, { event }) => {
    Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
      response.headers[key] = value;
    });
  });
});
