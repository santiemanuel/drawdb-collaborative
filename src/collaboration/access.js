const ROLES = new Set(["owner", "editor", "viewer"]);

// Public URLs remain read-only even when the browser also has an owner session.
// Private sessions must refresh all role-dependent controls after any role change.
export function accessRoleChanged(expectedRole, actualRole, isPublic = false) {
  if (!ROLES.has(actualRole)) return true;
  return !isPublic && expectedRole !== actualRole;
}
