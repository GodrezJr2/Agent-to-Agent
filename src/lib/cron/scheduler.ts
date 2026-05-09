import { getEnabledCronJobs, updateCronJob, getAgentById, createMessage } from "@/lib/db";

let interval: ReturnType<typeof setInterval> | null = null;

export function startCronScheduler() {
  if (interval) return;
  interval = setInterval(tickCronJobs, 30000);
  console.log("[Cron] Scheduler started");
}

export function stopCronScheduler() {
  if (interval) { clearInterval(interval); interval = null; }
}

async function tickCronJobs() {
  try {
    const jobs = await getEnabledCronJobs();
    const now = new Date();

    for (const job of jobs) {
      try {
        // Basic interval checking using lastRun
        const lastRun = job.lastRun ? new Date(job.lastRun) : new Date(job.createdAt);
        const intervalMs = parseSimpleSchedule(job.schedule);
        if (intervalMs === null) continue;

        const nextRun = new Date(lastRun.getTime() + intervalMs);
        if (nextRun <= now) {
          console.log(`[Cron] Triggering job ${job.id} for agent ${job.agentId}`);

          const nextNextRun = new Date(now.getTime() + intervalMs);
          await updateCronJob(job.id, {
            lastRun: now.toISOString(),
            nextRun: nextNextRun.toISOString(),
          });

          const agent = await getAgentById(job.agentId);
          if (!agent) continue;

          await createMessage({
            officeId: job.officeId,
            agentId: job.agentId,
            role: "system",
            content: `[Cron triggered: ${job.schedule}] Prompt: ${job.prompt}`,
          });
        }
      } catch (err) {
        console.error(`[Cron] Job ${job.id} failed:`, err);
      }
    }
  } catch (err) {
    console.error("[Cron] Tick error:", err);
  }
}

function parseSimpleSchedule(schedule: string): number | null {
  // Support simple schedules: "5m", "1h", "30s", "1d"
  const match = schedule.match(/^(\d+)\s*(s|m|h|d)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * (multipliers[unit] || 0);
}
