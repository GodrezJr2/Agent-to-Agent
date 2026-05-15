import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToJob(row) {
  if (!row) return null;
  const pipeline = row.pipeline ? (typeof row.pipeline === "string" ? JSON.parse(row.pipeline) : row.pipeline) : null;
  return { id: row.id, agentId: row.agentId, officeId: row.officeId, schedule: row.schedule, prompt: row.prompt, pipeline, enabled: row.enabled === 1, lastRun: row.lastRun, nextRun: row.nextRun, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export async function getCronJobsByOffice(officeId) {
  const db = await getAdapter();
  return db.all(`SELECT * FROM cronJobs WHERE officeId = ? ORDER BY createdAt DESC`, [officeId]).map(rowToJob);
}

export async function getCronJobsByAgent(agentId) {
  const db = await getAdapter();
  return db.all(`SELECT * FROM cronJobs WHERE agentId = ? ORDER BY createdAt DESC`, [agentId]).map(rowToJob);
}

export async function createCronJob({ agentId, officeId, schedule, prompt, pipeline }) {
  const db = await getAdapter();
  const pipelineJson = pipeline ? JSON.stringify(pipeline) : null;
  const job = { id: uuidv4(), agentId, officeId, schedule, prompt: prompt || null, pipeline: pipeline || null, enabled: true, lastRun: null, nextRun: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.run(`INSERT INTO cronJobs(id, agentId, officeId, schedule, prompt, pipeline, enabled, lastRun, nextRun, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [job.id, job.agentId, job.officeId, job.schedule, job.prompt, pipelineJson, 1, job.lastRun, job.nextRun, job.createdAt, job.updatedAt]);
  return job;
}

export async function updateCronJob(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM cronJobs WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToJob(row), ...data, updatedAt: new Date().toISOString() };
    const pipelineJson = merged.pipeline ? JSON.stringify(merged.pipeline) : null;
    db.run(`UPDATE cronJobs SET schedule = ?, prompt = ?, pipeline = ?, enabled = ?, lastRun = ?, nextRun = ?, updatedAt = ? WHERE id = ?`, [merged.schedule, merged.prompt, pipelineJson, merged.enabled ? 1 : 0, merged.lastRun, merged.nextRun, merged.updatedAt, id]);
    result = merged;
  });
  return result;
}

export async function deleteCronJob(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM cronJobs WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function getEnabledCronJobs() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM cronJobs WHERE enabled = 1`).map(rowToJob);
}
