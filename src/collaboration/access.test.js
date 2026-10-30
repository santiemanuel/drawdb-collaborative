import assert from "node:assert/strict";
import test from "node:test";
import { accessRoleChanged } from "./access.js";

test("reconnect refreshes downgraded and upgraded private roles", () => {
  assert.equal(accessRoleChanged("editor", "viewer"), true);
  assert.equal(accessRoleChanged("owner", "editor"), true);
  assert.equal(accessRoleChanged("viewer", "editor"), true);
  assert.equal(accessRoleChanged("editor", "editor"), false);
  assert.equal(accessRoleChanged("viewer", "viewer"), false);
});
test("public links stay read-only regardless of signed-in role", () => {
  assert.equal(accessRoleChanged("viewer", "owner", true), false);
  assert.equal(accessRoleChanged("viewer", "viewer", true), false);
});
test("missing and invalid canonical roles fail closed", () => {
  for (const role of [undefined, null, "admin", "", false]) {
    assert.equal(accessRoleChanged("editor", role), true);
    assert.equal(accessRoleChanged("viewer", role, true), true);
  }
});
