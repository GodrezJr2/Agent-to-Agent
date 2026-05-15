// Add pipeline column to cronJobs for sequential multi-agent workflows
export default {
  version: 2,
  name: "cron-pipeline",
  up(db) {
    try {
      db.exec(`ALTER TABLE cronJobs ADD COLUMN pipeline TEXT`);
    } catch (e) {
      if (!e.message?.includes("duplicate column")) throw e;
    }
  },
};
