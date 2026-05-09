import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToOffice(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, description: row.description, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export async function getOffices() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM offices ORDER BY createdAt DESC`).map(rowToOffice);
}

export async function getOfficeById(id) {
  const db = await getAdapter();
  return rowToOffice(db.get(`SELECT * FROM offices WHERE id = ?`, [id]));
}

export async function createOffice({ name, description }) {
  const db = await getAdapter();
  const office = { id: uuidv4(), name, description: description || null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.run(`INSERT INTO offices(id, name, description, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?)`, [office.id, office.name, office.description, office.createdAt, office.updatedAt]);
  return office;
}

export async function updateOffice(id, { name, description }) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM offices WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToOffice(row), name: name ?? row.name, description: description !== undefined ? description : row.description, updatedAt: new Date().toISOString() };
    db.run(`UPDATE offices SET name = ?, description = ?, updatedAt = ? WHERE id = ?`, [merged.name, merged.description, merged.updatedAt, id]);
    result = merged;
  });
  return result;
}

export async function deleteOffice(id) {
  const db = await getAdapter();
  db.transaction(() => {
    db.run(`DELETE FROM officeAgents WHERE officeId = ?`, [id]);
    db.run(`DELETE FROM chatMessages WHERE officeId = ?`, [id]);
    db.run(`DELETE FROM cronJobs WHERE officeId = ?`, [id]);
    db.run(`DELETE FROM memoryEntries WHERE officeId = ?`, [id]);
    db.run(`DELETE FROM a2aMessages WHERE officeId = ?`, [id]);
    db.run(`DELETE FROM offices WHERE id = ?`, [id]);
  });
  return true;
}
