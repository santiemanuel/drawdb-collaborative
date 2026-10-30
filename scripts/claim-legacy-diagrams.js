import { openDatabase, createDiagramStore } from "../server/database.js";
import { createAccessStore, normalizeEmail } from "../server/access.js";

/* global process */
// Local administrator operation only. Never expose this command through HTTP.
const [email, projectName, confirmation] = process.argv.slice(2);
if (!email || !projectName || confirmation !== "--confirm-backup") {
  console.error(
    'Usage: node scripts/claim-legacy-diagrams.js owner@example.com "Recovered diagrams" --confirm-backup',
  );
  console.error(
    "Back up the persistent database first. The owner must have signed in already. No records are deleted.",
  );
  process.exitCode = 1;
} else {
  const db = openDatabase();
  try {
    const access = createAccessStore(db);
    createDiagramStore(db);
    const matches = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .all(normalizeEmail(email));
    if (matches.length !== 1)
      throw new Error(
        "Expected exactly one verified existing owner. Sign in first or resolve duplicate identities manually.",
      );
    if (!projectName.trim() || projectName.length > 200)
      throw new Error("Project name must be between 1 and 200 characters.");
    const count = db
      .prepare(
        "SELECT COUNT(*) AS count FROM diagrams WHERE project_id IS NULL",
      )
      .get().count;
    if (!count)
      console.log("No unowned legacy diagrams remain. Nothing changed.");
    else {
      const result = db.transaction(() => {
        const project = access.createProject(projectName.trim(), matches[0].id);
        const changed = db
          .prepare(
            "UPDATE diagrams SET project_id = ? WHERE project_id IS NULL",
          )
          .run(project.id).changes;
        return { project, changed };
      })();
      console.log(
        `Assigned ${result.changed} legacy diagram(s) to project ${result.project.id}.`,
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
