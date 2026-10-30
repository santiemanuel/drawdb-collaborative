import { useEffect } from "react";
import { useCollab, useTransform } from "../hooks";
import { canFollowParticipant } from "../collaboration/viewport";

export default function CollaborationViewport() {
  const { transform, setRemoteTransform } = useTransform();
  const {
    connectionState,
    emitViewport,
    followingClientId,
    identity,
    remoteViewports,
    stopFollowing,
  } = useCollab();
  const viewport = remoteViewports[followingClientId];

  useEffect(() => {
    if (connectionState !== "connected") return;
    emitViewport({
      x: transform.pan.x,
      y: transform.pan.y,
      zoom: transform.zoom,
      followingClientId,
    });
  }, [
    connectionState,
    emitViewport,
    followingClientId,
    transform.pan.x,
    transform.pan.y,
    transform.zoom,
  ]);

  useEffect(() => {
    if (
      !followingClientId ||
      !viewport ||
      !canFollowParticipant(
        identity.clientId,
        followingClientId,
        remoteViewports,
      )
    )
      return;
    setRemoteTransform({
      pan: { x: viewport.x, y: viewport.y },
      zoom: viewport.zoom,
    });
  }, [
    followingClientId,
    identity.clientId,
    remoteViewports,
    setRemoteTransform,
    viewport,
  ]);

  useEffect(() => {
    if (!followingClientId) return;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") stopFollowing();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [followingClientId, stopFollowing]);

  return null;
}
