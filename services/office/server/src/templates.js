// Starter teams offered when creating an office. The first agent in each list
// is the lead; `reportsTo` refers to another entry's key.
export const TEAM_TEMPLATES = [
  {
    id: "web-studio",
    name: "Web Studio",
    description: "Ships small web projects end to end: plan, build, review.",
    agents: [
      { key: "lead", name: "Maya", role: "Tech Lead", description: "Breaks requests into tasks, delegates, reviews the result before reporting back." },
      { key: "fe", name: "Kevin", role: "Frontend Engineer", reportsTo: "lead", description: "Builds HTML, CSS and JavaScript interfaces in the workspace." },
      { key: "be", name: "Rafi", role: "Backend Engineer", reportsTo: "lead", description: "Writes server code, scripts and data handling; runs and tests it with bash." },
      { key: "qa", name: "Sari", role: "QA Reviewer", reportsTo: "lead", description: "Reads what the team produced, runs checks, and reports concrete defects." },
    ],
  },
  {
    id: "research-squad",
    name: "Research Squad",
    description: "Answers questions from the web with sources and a written brief.",
    agents: [
      { key: "lead", name: "Nadia", role: "Research Lead", description: "Frames the question, splits it into lines of inquiry, and writes the final brief." },
      { key: "web", name: "Dimas", role: "Web Researcher", reportsTo: "lead", description: "Searches and reads sources; returns findings with URLs." },
      { key: "an", name: "Ayu", role: "Analyst", reportsTo: "lead", description: "Compares findings, checks claims against each other, flags gaps." },
    ],
  },
  {
    id: "content-desk",
    name: "Content Desk",
    description: "Drafts, edits and packages written content.",
    agents: [
      { key: "lead", name: "Lina", role: "Managing Editor", description: "Sets the angle and structure, assigns pieces, edits the final copy." },
      { key: "writer", name: "Tomi", role: "Writer", reportsTo: "lead", description: "Writes drafts to the workspace in the requested voice." },
      { key: "seo", name: "Rara", role: "SEO Specialist", reportsTo: "lead", description: "Researches keywords and tightens titles, headings and meta text." },
    ],
  },
  {
    id: "solo",
    name: "Solo Agent",
    description: "One capable generalist. Add teammates later.",
    agents: [{ key: "lead", name: "Atlas", role: "Generalist", description: "Handles any task directly with the full tool set." }],
  },
];

/** Create a template's agents in an office, wiring reportsTo to real ids. */
export function applyTeamTemplate(db, officeId, templateId, { model = "" } = {}) {
  const template = TEAM_TEMPLATES.find((t) => t.id === templateId);
  if (!template) return [];
  const ids = {};
  const created = [];
  for (const a of template.agents) {
    const agent = db.createAgent(officeId, {
      name: a.name,
      role: a.role,
      description: a.description,
      model,
      managerId: a.reportsTo ? ids[a.reportsTo] : null,
    });
    ids[a.key] = agent.id;
    created.push(agent);
  }
  return created;
}
