/** Conservative cap: old queued reminders require a new generation/review. */
export function isNotificationStale(scheduledAt: string, now = new Date()): boolean {
  const at = Date.parse(scheduledAt);
  return !Number.isFinite(at) || now.getTime() - at > 24 * 3600_000;
}
