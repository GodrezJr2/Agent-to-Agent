import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    agentId: row.agentId,
    fromAgentId: row.fromAgentId || null,
    officeId: row.officeId,
    status: row.status,
    input: row.input ? JSON.parse(row.input) : null,
    output: row.output ? JSON.parse(row.output) : null,
    error: row.error || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createTask({ agentId, fromAgentId, officeId, input }) {
  const db = await getAdapter();
  const task = {
    id: uuidv4(),
    agentId,
    fromAgentId: fromAgentId || null,
    officeId,
    status: "submitted",
    input: JSON.stringify(input),
    output: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO a2aTasks(id, agentId, fromAgentId, officeId, status, input, output, error, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [task.id, task.agentId, task.fromAgentId, task.officeId, task.status, task.input, task.output, task.error, task.createdAt, task.updatedAt]
  );
  return rowToTask({ ...task });
}

export async function getTask(id) {
  const db = await getAdapter();
  return rowToTask(db.get(`SELECT * FROM a2aTasks WHERE id = ?`, [id]));
}

export async function updateTask(id, { status, output, error }) {
  const db = await getAdapter();
  const updatedAt = new Date().toISOString();
  db.run(
    `UPDATE a2aTasks SET status = COALESCE(?, status), output = COALESCE(?, output), error = COALESCE(?, error), updatedAt = ? WHERE id = ?`,
    [status || null, output ? JSON.stringify(output) : null, error || null, updatedAt, id]
  );
  return getTask(id);
}

export async function getTasksByAgent(agentId, { limit = 20 } = {}) {
  const db = await getAdapter();
  return db.all(`SELECT * FROM a2aTasks WHERE agentId = ? ORDER BY createdAt DESC LIMIT ?`, [agentId, limit]).map(rowToTask);
}
