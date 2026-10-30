import assert from "node:assert/strict";
import test from "node:test";
import { canFollowParticipant, isValidViewport } from "./viewport.js";

test("viewport awareness rejects unusable cameras and invalid follow identities", () => {
  const camera = { x: -150, y: 400, zoom: 1.2, followingClientId: null };
  assert.equal(isValidViewport(camera), true);
  for (const invalid of [
    null,
    [],
    { ...camera, x: Infinity },
    { ...camera, y: NaN },
    { ...camera, zoom: 0 },
    { ...camera, zoom: 6 },
    { ...camera, followingClientId: "../other" },
  ])
    assert.equal(isValidViewport(invalid), false);
});

test("following permits chains while rejecting self, mutual and indirect loops", () => {
  const cameras = {
    presenter: { followingClientId: null },
    follower: { followingClientId: "presenter" },
    indirect: { followingClientId: "follower" },
  };
  assert.equal(canFollowParticipant("viewer", "presenter", cameras), true);
  assert.equal(canFollowParticipant("viewer", "indirect", cameras), true);
  assert.equal(canFollowParticipant("viewer", "viewer", cameras), false);
  assert.equal(canFollowParticipant("presenter", "follower", cameras), false);
  assert.equal(canFollowParticipant("presenter", "indirect", cameras), false);
  assert.equal(canFollowParticipant("viewer", null, cameras), false);
  assert.equal(
    canFollowParticipant("viewer", "a", {
      a: { followingClientId: "b" },
      b: { followingClientId: "a" },
    }),
    false,
  );
});
