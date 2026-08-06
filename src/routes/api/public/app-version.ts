import { createFileRoute } from '@tanstack/react-router'
import { BUILD_ID, DEPLOYED_AT } from '@/lib/build-id.server'

export const Route = createFileRoute('/api/public/app-version')({
  server: {
    handlers: {
      GET: async () => {
        return new Response(
          JSON.stringify({ buildId: BUILD_ID, deployedAt: DEPLOYED_AT }),
          {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store, max-age=0',
              'CDN-Cache-Control': 'no-store',
            }
          }
        )
      }
    }
  }
})
