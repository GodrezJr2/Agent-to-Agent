import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToAgent(row) {
  if (!row) return null;
  return {
    id: row.id,
    officeId: row.officeId,
    name: row.name,
    role: row.role,
    comboId: row.comboId,
    systemPrompt: row.systemPrompt,
    characterSprite: row.characterSprite || "default",
    seatX: row.seatX ?? 0,
    seatY: row.seatY ?? 0,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getAgentsByOffice(officeId) {
  const db = await getAdapter();
  return db.all(`SELECT * FROM officeAgents WHERE officeId = ? ORDER BY createdAt ASC`, [officeId]).map(rowToAgent);
}

export async function getAgentById(id) {
  const db = await getAdapter();
  return rowToAgent(db.get(`SELECT * FROM officeAgents WHERE id = ?`, [id]));
}

export async function createAgent({ officeId, name, role, comboId, systemPrompt, characterSprite }) {
  const db = await getAdapter();
  const agent = {
    id: uuidv4(),
    officeId,
    name,
    role: role || null,
    comboId: comboId || null,
    systemPrompt: systemPrompt || null,
    characterSprite: characterSprite || "default",
    seatX: 0,
    seatY: 0,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO officeAgents(id, officeId, name, role, comboId, systemPrompt, characterSprite, seatX, seatY, isActive, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [agent.id, agent.officeId, agent.name, agent.role, agent.comboId, agent.systemPrompt, agent.characterSprite, agent.seatX, agent.seatY, 1, agent.createdAt, agent.updatedAt]
  );
  return agent;
}

export async function updateAgent(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM officeAgents WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToAgent(row);
    const merged = {
      ...current,
      name: data.name ?? current.name,
      role: data.role !== undefined ? data.role : current.role,
      comboId: data.comboId !== undefined ? data.comboId : current.comboId,
      systemPrompt: data.systemPrompt !== undefined ? data.systemPrompt : current.systemPrompt,
      characterSprite: data.characterSprite ?? current.characterSprite,
      seatX: data.seatX ?? current.seatX,
      seatY: data.seatY ?? current.seatY,
      isActive: data.isActive !== undefined ? data.isActive : current.isActive,
      updatedAt: new Date().toISOString(),
    };
    db.run(
      `UPDATE officeAgents SET name = ?, role = ?, comboId = ?, systemPrompt = ?, characterSprite = ?, seatX = ?, seatY = ?, isActive = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.role, merged.comboId, merged.systemPrompt, merged.characterSprite, merged.seatX, merged.seatY, merged.isActive ? 1 : 0, merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteAgent(id) {
  const db = await getAdapter();
  db.transaction(() => {
    db.run(`DELETE FROM chatMessages WHERE agentId = ?`, [id]);
    db.run(`DELETE FROM cronJobs WHERE agentId = ?`, [id]);
    db.run(`DELETE FROM memoryEntries WHERE agentId = ?`, [id]);
    db.run(`DELETE FROM a2aMessages WHERE fromAgentId = ? OR toAgentId = ?`, [id, id]);
    db.run(`DELETE FROM officeAgents WHERE id = ?`, [id]);
  });
  return true;
}

export async function getActiveAgentsByOffice(officeId) {
  const db = await getAdapter();
  return db.all(`SELECT * FROM officeAgents WHERE officeId = ? AND isActive = 1 ORDER BY createdAt ASC`, [officeId]).map(rowToAgent);
}
