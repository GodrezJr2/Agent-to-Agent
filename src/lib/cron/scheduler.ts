import { getEnabledCronJobs, updateCronJob, getAgentById, createMessage } from "@/lib/db";

const PORT = process.env.PORT || 20128;
const BASE_URL = `http://localhost:${PORT}`;

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
        const lastRun = job.lastRun ? new Date(job.lastRun) : new Date(job.createdAt);
        const intervalMs = parseSimpleSchedule(job.schedule);
        if (intervalMs === null) continue;

        const nextRun = new Date(lastRun.getTime() + intervalMs);
        if (nextRun <= now) {
          console.log(`[Cron] Triggering job ${job.id} for agent ${job.agentId}`);

          await updateCronJob(job.id, {
            lastRun: now.toISOString(),
            nextRun: new Date(now.getTime() + intervalMs).toISOString(),
          });

          const agent = await getAgentById(job.agentId);
          if (!agent) continue;

          await createMessage({
            officeId: job.officeId,
            agentId: job.agentId,
            role: "system",
            content: `[Cron: ${job.schedule}] ${job.prompt}`,
          });

          // Actually invoke the agent via A2A
          try {
            const res = await fetch(`${BASE_URL}/api/agents/${job.agentId}/a2a`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: Date.now(),
                method: "message/send",
                params: {
                  message: { role: "user", parts: [{ type: "text", text: job.prompt }] },
                  metadata: { fromCron: true, schedule: job.schedule, officeId: job.officeId },
                },
              }),
            });
            if (!res.ok) console.error(`[Cron] A2A failed for job ${job.id}: HTTP ${res.status}`);
            else console.log(`[Cron] A2A done for job ${job.id}`);
          } catch (fetchErr) {
            console.error(`[Cron] A2A fetch error for job ${job.id}:`, fetchErr);
          }
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
