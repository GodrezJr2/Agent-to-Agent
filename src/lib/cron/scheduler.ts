import { getEnabledCronJobs, updateCronJob, getAgentById, createMessage } from "@/lib/db";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const PORT = process.env.PORT || 20128;
const BASE_URL = `http://localhost:${PORT}`;
const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let interval: ReturnType<typeof setInterval> | null = null;
let cachedCliToken: string | null = null;

async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

export function startCronScheduler() {
  if (interval) return;
  interval = setInterval(tickCronJobs, 30000);
  console.log("[Cron] Scheduler started");
}

export function stopCronScheduler() {
  if (interval) { clearInterval(interval); interval = null; }
}

async function callA2A(agentId: string, prompt: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/agents/${agentId}/a2a`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [CLI_TOKEN_HEADER]: await getCliToken(),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "message/send",
      params: {
        message: { role: "user", parts: [{ type: "text", text: prompt }] },
        metadata: { fromCron: true },
      },
    }),
  });
  if (!res.ok) throw new Error(`A2A HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const artifact = data.result?.artifacts?.[0];
  return artifact?.parts?.map((p: any) => p.text || "").join("") || "";
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
        if (nextRun > now) continue;

        console.log(`[Cron] Triggering job ${job.id}`);
        await updateCronJob(job.id, {
          lastRun: now.toISOString(),
          nextRun: new Date(now.getTime() + intervalMs).toISOString(),
        });

        const pipeline: Array<{ agentId: string; prompt: string }> | null = job.pipeline || null;

        if (pipeline && pipeline.length > 0) {
          // Pipeline mode: run steps sequentially, accumulate all outputs for context
          console.log(`[Cron] Pipeline mode: ${pipeline.length} steps`);
          const stepOutputs: string[] = [];
          for (let i = 0; i < pipeline.length; i++) {
            const step = pipeline[i];
            const agent = await getAgentById(step.agentId);
            if (!agent) { console.error(`[Cron] Pipeline step ${i} agent ${step.agentId} not found`); continue; }

            let prompt = step.prompt;
            if (stepOutputs.length > 0) {
              const ctx = stepOutputs
                .map((out, idx) => `--- Step ${idx + 1} (${pipeline[idx].agentId}) ---\n${out}`)
                .join("\n\n")
                .slice(0, 8000);
              prompt = `${step.prompt}\n\n=== Context from previous pipeline steps ===\n${ctx}`;
            }

            const promptPreview = step.prompt.length > 80 ? step.prompt.slice(0, 80) + "…" : step.prompt;
            await createMessage({ officeId: job.officeId, agentId: step.agentId, role: "system", content: `[Pipeline ${i + 1}/${pipeline.length}] ${agent.name}: ${promptPreview}` });

            try {
              const output = await callA2A(step.agentId, prompt);
              stepOutputs.push(output);
              console.log(`[Cron] Pipeline step ${i + 1} done: ${output.slice(0, 80)}`);
            } catch (err: any) {
              console.error(`[Cron] Pipeline step ${i + 1} failed:`, err.message);
              stepOutputs.push(`Error: ${err.message}`);
            }
          }
        } else {
          // Single agent mode
          const agent = await getAgentById(job.agentId);
          if (!agent) continue;

          const singlePreview = job.prompt.length > 80 ? job.prompt.slice(0, 80) + "…" : job.prompt;
          await createMessage({ officeId: job.officeId, agentId: job.agentId, role: "system", content: `[Cron ${job.schedule}] ${agent.name}: ${singlePreview}` });

          try {
            await callA2A(job.agentId, job.prompt);
            console.log(`[Cron] Single agent done for job ${job.id}`);
          } catch (err: any) {
            console.error(`[Cron] A2A error for job ${job.id}:`, err.message);
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
  const match = schedule.match(/^(\d+)\s*(s|m|h|d)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * (multipliers[unit] || 0);
}
