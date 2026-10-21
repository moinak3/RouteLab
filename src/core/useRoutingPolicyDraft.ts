import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  initialDraftSync,
  loadDraftRoutingPolicy,
  saveDraftRoutingPolicy,
  type DraftRoutingPolicy,
} from "./routingDraft";
import {
  fetchRoutingPolicyDraft,
  persistRoutingPolicyDraft,
  RoutingPolicyConflictError,
} from "./routingPolicyPersistence";

export type RoutingPolicySaveState = "loading" | "saving" | "saved" | "offline" | "conflict";

type RoutingPolicyDraftStatus = {
  state: RoutingPolicySaveState;
  revision: number;
  savedAt: string | null;
  imported: boolean;
};

export function useRoutingPolicyDraft(defaultFallbackModelId: string, options: { readOnly?: boolean } = {}) {
  const [draftPolicy, setDraftPolicy] = useState<DraftRoutingPolicy>(() => loadDraftRoutingPolicy(defaultFallbackModelId));
  const [status, setStatus] = useState<RoutingPolicyDraftStatus>({ state: "loading", revision: 0, savedAt: null, imported: false });
  const [conflictingDraft, setConflictingDraft] = useState<DraftRoutingPolicy | null>(null);
  const revisionRef = useRef(0);
  const readyRef = useRef(false);
  const lastSavedUpdateRef = useRef<string | null>(null);
  const policyRef = useRef(draftPolicy);
  policyRef.current = draftPolicy;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const initialize = async () => {
      try {
        const server = await fetchRoutingPolicyDraft(controller.signal);
        if (!active) return;
        revisionRef.current = server.revision;
        const selected = initialDraftSync(policyRef.current, server.draft);
        if (server.draft) {
          setDraftPolicy(selected.draft);
          saveDraftRoutingPolicy(selected.draft);
          lastSavedUpdateRef.current = selected.draft.updatedAt;
          readyRef.current = true;
          setStatus({ state: "saved", revision: server.revision, savedAt: server.updatedAt, imported: false });
          return;
        }
        if (options.readOnly) {
          readyRef.current = true;
          setStatus({ state: "offline", revision: 0, savedAt: null, imported: false });
          return;
        }
        const imported = await persistRoutingPolicyDraft(selected.draft, 0, controller.signal);
        if (!active) return;
        revisionRef.current = imported.revision;
        lastSavedUpdateRef.current = selected.draft.updatedAt;
        readyRef.current = true;
        setStatus({ state: "saved", revision: imported.revision, savedAt: imported.updatedAt, imported: true });
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        readyRef.current = true;
        setStatus({ state: "offline", revision: 0, savedAt: null, imported: false });
      }
    };
    void initialize();
    return () => { active = false; controller.abort(); };
  }, [options.readOnly]);

  useEffect(() => {
    saveDraftRoutingPolicy(draftPolicy);
    if (options.readOnly || !readyRef.current || draftPolicy.updatedAt === lastSavedUpdateRef.current) return;
    setStatus(current => ({ ...current, state: "saving", imported: false }));
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const saved = await persistRoutingPolicyDraft(draftPolicy, revisionRef.current, controller.signal);
        revisionRef.current = saved.revision;
        lastSavedUpdateRef.current = draftPolicy.updatedAt;
        if (policyRef.current.updatedAt === draftPolicy.updatedAt) {
          setStatus({ state: "saved", revision: saved.revision, savedAt: saved.updatedAt, imported: false });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof RoutingPolicyConflictError) {
          revisionRef.current = error.current.revision;
          setConflictingDraft(error.current.draft);
          setStatus({ state: "conflict", revision: error.current.revision, savedAt: error.current.updatedAt, imported: false });
          return;
        }
        setStatus(current => ({ ...current, state: "offline", imported: false }));
      }
    }, 650);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [draftPolicy, options.readOnly]);

  const useServerDraft = useCallback(() => {
    if (!conflictingDraft) return;
    lastSavedUpdateRef.current = conflictingDraft.updatedAt;
    saveDraftRoutingPolicy(conflictingDraft);
    setDraftPolicy(conflictingDraft);
    setConflictingDraft(null);
    setStatus(current => ({ ...current, state: "saved", imported: false }));
  }, [conflictingDraft]);

  const retryMyDraft = useCallback(async () => {
    setStatus(current => ({ ...current, state: "saving", imported: false }));
    try {
      const saved = await persistRoutingPolicyDraft(policyRef.current, revisionRef.current);
      revisionRef.current = saved.revision;
      lastSavedUpdateRef.current = policyRef.current.updatedAt;
      setConflictingDraft(null);
      setStatus({ state: "saved", revision: saved.revision, savedAt: saved.updatedAt, imported: false });
    } catch {
      setStatus(current => ({ ...current, state: "conflict", imported: false }));
    }
  }, []);

  return {
    draftPolicy,
    setDraftPolicy: setDraftPolicy as Dispatch<SetStateAction<DraftRoutingPolicy>>,
    status,
    useServerDraft,
    retryMyDraft,
  };
}
