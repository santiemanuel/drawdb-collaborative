import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCollab } from "../hooks";
import { canFollowParticipant } from "../collaboration/viewport";

export default function CollaborationPanel({ inline = false }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const listId = useId();
  const {
    connectionState,
    participants,
    identity,
    remoteViewports,
    followingClientId,
    followParticipant,
    stopFollowing,
  } = useCollab();
  const followed = participants.find(
    (item) => item.clientId === followingClientId,
  );

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event) => {
      if (!panelRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div
      ref={panelRef}
      className={`${inline ? "collaboration-panel-inline relative ms-auto shrink-0" : "absolute right-3 top-3 max-w-[calc(100%-1.5rem)]"} z-40 flex flex-col items-end gap-2 text-xs text-zinc-800 dark:text-zinc-100`}
    >
      <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white/95 px-3 py-1.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/95">
        <span
          role="img"
          aria-label={t(`collaboration_${connectionState}`, connectionState)}
          className={`h-2 w-2 rounded-full ${connectionState === "connected" ? "bg-emerald-500" : connectionState === "connecting" ? "bg-amber-500" : "bg-red-500"}`}
        />
        <span
          className="collaboration-connection-label"
          title={t(`collaboration_${connectionState}`, connectionState)}
        >
          {t(`collaboration_${connectionState}`, connectionState)}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
          className="rounded px-1 py-0.5 font-medium hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:hover:bg-zinc-800"
        >
          {t("collaboration_participants", { count: participants.length })}
          <i
            aria-hidden="true"
            className={`bi ml-1 ${open ? "bi-chevron-up" : "bi-chevron-down"}`}
          />
        </button>
      </div>
      <div
        className={`${inline ? "absolute right-0 top-full mt-2 max-h-[calc(100dvh-140px)] overflow-y-auto" : ""} flex flex-col items-end gap-2 max-w-[calc(100vw-1.5rem)] whitespace-normal`}
      >
        {open && (
          <div
            id={listId}
            className="w-72 max-w-full rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <p className="mb-2 font-semibold">{t("collaboration_people")}</p>
            <ul
              className="max-h-64 space-y-2 overflow-y-auto"
              aria-label={t("collaboration_people")}
            >
              {participants.map((participant) => {
                const isSelf = participant.clientId === identity.clientId;
                const isFollowing = participant.clientId === followingClientId;
                const canFollow =
                  connectionState === "connected" &&
                  Boolean(remoteViewports[participant.clientId]) &&
                  canFollowParticipant(
                    identity.clientId,
                    participant.clientId,
                    remoteViewports,
                  );
                return (
                  <li
                    key={participant.clientId}
                    className="flex items-center gap-2"
                  >
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: participant.color }}
                    />
                    <span className="min-w-0 flex-1 break-words">
                      {participant.displayName}
                      {isSelf ? ` (${t("collaboration_you")})` : ""}
                    </span>
                    {!isSelf && (
                      <button
                        type="button"
                        disabled={!isFollowing && !canFollow}
                        aria-label={t(
                          isFollowing
                            ? "collaboration_stop_following_person"
                            : "collaboration_follow_person",
                          { name: participant.displayName },
                        )}
                        onClick={() => {
                          if (isFollowing) stopFollowing();
                          else followParticipant(participant.clientId);
                          setOpen(false);
                        }}
                        className="shrink-0 rounded border border-blue-300 px-2 py-1 text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950"
                      >
                        {t(
                          isFollowing
                            ? "collaboration_stop_following"
                            : "collaboration_follow",
                        )}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-zinc-500 dark:text-zinc-400">
              {t("collaboration_follow_hint")}
            </p>
          </div>
        )}
        {followed && (
          <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 shadow-sm dark:border-blue-700 dark:bg-blue-950">
            <span role="status">
              {t("collaboration_following", { name: followed.displayName })}
            </span>
            <button
              type="button"
              onClick={stopFollowing}
              title={t("collaboration_follow_exit_hint")}
              className="rounded border border-blue-300 px-2 py-1 font-medium hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-blue-700 dark:hover:bg-blue-900"
            >
              {t("collaboration_stop_following")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
