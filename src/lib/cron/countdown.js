export function getScheduleMs(schedule) {
  const match = String(schedule || "").match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * multipliers[unit];
}

export function getJobNextRun(job, now = new Date()) {
  if (!job) return null;

  if (job.nextRun) {
    const nextRun = new Date(job.nextRun);
    if (!Number.isNaN(nextRun.getTime())) return nextRun;
  }

  const intervalMs = getScheduleMs(job.schedule);
  if (!intervalMs) return null;

  const baseValue = job.lastRun || job.createdAt;
  if (!baseValue) return null;

  const base = new Date(baseValue);
  if (Number.isNaN(base.getTime())) return null;

  return new Date(base.getTime() + intervalMs);
}

export function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function getJobCountdownLabel(job, now = new Date()) {
  if (!job?.enabled) return "paused";

  const nextRun = getJobNextRun(job, now);
  if (!nextRun) return "unknown";

  const remainingMs = nextRun.getTime() - now.getTime();
  if (remainingMs <= 0) return "due now";
  return `in ${formatCountdown(remainingMs)}`;
}

export function getNextEnabledJob(jobs, now = new Date()) {
  return (jobs || [])
    .filter((job) => job.enabled)
    .map((job) => ({ job, nextRun: getJobNextRun(job, now) }))
    .filter((item) => item.nextRun)
    .sort((a, b) => a.nextRun.getTime() - b.nextRun.getTime())[0] || null;
}
