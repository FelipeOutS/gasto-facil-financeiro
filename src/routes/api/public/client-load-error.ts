import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { supabaseAdmin } from '@/integrations/supabase/client.server'

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
  recovery_attempted: z.boolean().optional(),
  user_agent: z.string().max(512).optional(),
  anonymous_id: z.string().max(100).optional(),
})

export const Route = createFileRoute('/api/public/client-load-error')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const data = schema.parse(body)
          
          const { error } = await (supabaseAdmin as any)
            .from('client_load_errors')
            .insert([data])

          if (error) throw error
          
          return new Response(null, { status: 204 })
        } catch (e) {
          console.error('[Diagnostic Endpoint Error]', e)
          return new Response('Invalid request', { status: 400 })
        }
      }
    }
  }
})
