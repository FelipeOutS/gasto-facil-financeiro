import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { supabaseAdmin } from '@/integrations/supabase/client.server'

/** Limite duro do corpo bruto: 32KB. Acima disso rejeitamos sem persistir. */
const MAX_BODY_BYTES = 32 * 1024

const schema = z.object({
  error_type: z.string().max(50),
  error_name: z.string().max(255).optional(),
  error_message: z.string().max(1000).optional(),
  stack_trace: z.string().max(5000).optional(),
  resource_url: z.string().max(2048).optional(),
  current_route: z.string().max(2048).optional(),
  navigator_online: z.boolean().optional(),
  js_build_id: z.string().max(100).optional(),
  html_build_id: z.string().max(100).optional(),
  server_build_id: z.string().max(100).optional(),
  deployment_id: z.string().max(100).optional(),
  sw_state: z.string().max(50).optional(),
  sw_controller_url: z.string().max(2048).optional(),
  cache_names: z.string().max(500).optional(),
  recovery_attempted: z.boolean().optional(),
  lineno: z.number().int().min(0).max(10_000_000).optional(),
  colno: z.number().int().min(0).max(10_000_000).optional(),
  user_agent: z.string().max(512).optional(),
  anonymous_id: z.string().max(100).optional(),
})

/** Remove query string / fragmento também no servidor (defesa em profundidade). */
function stripUrlSecrets(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value.split('?')[0]?.split('#')[0]
}

function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

export const Route = createFileRoute('/api/public/client-load-error')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const raw = await request.text()
          if (raw.length > MAX_BODY_BYTES) {
            return new Response('Payload too large', { status: 413 })
          }

          const data = schema.parse(JSON.parse(raw))

          // Rate limit persistente/distribuído (mecanismo canônico do projeto).
          const ip = clientIp(request)
          const { data: rl } = await supabaseAdmin.rpc('rate_limit_hit', {
            _key: `client-load-error:${ip}`,
            _route: '/api/public/client-load-error',
            _limit: 30,
            _window_seconds: 300,
            _ip_address: ip,
            _method: 'POST',
          })
          const blocked = Array.isArray(rl) ? rl[0]?.blocked : undefined
          if (blocked) return new Response(null, { status: 429 })

          const { error } = await supabaseAdmin.from('client_load_errors').insert({
            ...data,
            error_message: data.error_message?.slice(0, 1000),
            stack_trace: data.stack_trace?.slice(0, 5000),
            resource_url: stripUrlSecrets(data.resource_url),
            current_route: stripUrlSecrets(data.current_route),
            sw_controller_url: stripUrlSecrets(data.sw_controller_url),
            user_agent: (data.user_agent ?? request.headers.get('user-agent') ?? undefined)?.slice(
              0,
              512,
            ),
          })

          if (error) throw error

          return new Response(null, { status: 204 })
        } catch (e) {
          console.error('[Diagnostic Endpoint Error]', e)
          return new Response('Invalid request', { status: 400 })
        }
      },
    },
  },
})
