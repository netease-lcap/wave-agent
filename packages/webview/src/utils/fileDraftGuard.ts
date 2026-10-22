import type { FileViewState } from "../types";

/**
 * Unsaved-draft guard for the desktop file panel (spec
 * `desktop-file-panel.md`「文件面板内编辑与保存」场景 5/6).
 *
 * A draft lives in the tab's `fileView.draft`, and each pane is its own ChatApp
 * instance — but the leaving actions that must be interrupted (switch session,
 * switch workdir, new session, delete session) belong to the *window*
 * (DesktopApp / DesktopShell), not to the pane holding the draft. So the dirty
 * check and the confirmation meet in the middle:
 *
 * - every pane instance registers its own dirty checker + discarder on mount;
 * - the root instance (the one rendering the window chrome) registers the
 *   asker, which opens the shared confirm dialog and resolves with the answer.
 *
 * `withDraftGuard` is the whole protocol for a navigation call site: run the
 * action straight away when nothing is dirty, otherwise ask first and — when
 * the user chose 放弃 — drop the drafts and then run it. Dropping is part of the
 * deal: the pane's panel group is cached per session, so a draft left in place
 * would come back the next time that session is opened, which is not what
 * 「放弃」 said.
 */

/** A draft that differs from the content it was opened from. */
export const isFileViewDirty = (fileView?: FileViewState | null): boolean =>
  fileView?.draft !== undefined && fileView.draft !== fileView.content;

export interface DraftSource {
  hasDirty: () => boolean;
  /** Drop every draft this source holds (user chose 放弃). */
  discard: () => void;
}

const draftSources = new Set<DraftSource>();

let discardAsker: (() => Promise<boolean>) | null = null;

/** Registers one pane's draft source; returns the unregister function. */
export function registerDraftSource(source: DraftSource): () => void {
  draftSources.add(source);
  return () => {
    draftSources.delete(source);
  };
}

/** Registered by the root ChatApp instance only (it renders the dialog). */
export function setDiscardAsker(asker: (() => Promise<boolean>) | null): void {
  discardAsker = asker;
}

export function hasAnyDirtyDraft(): boolean {
  for (const source of draftSources) {
    if (source.hasDirty()) return true;
  }
  return false;
}

export function discardAllDrafts(): void {
  for (const source of draftSources) source.discard();
}

/**
 * Resolves true when it is fine to drop the drafts: either the user chose
 * 「放弃」, or no dialog is mounted (nothing to ask — navigation must never be
 * blocked by a missing UI).
 */
export function askDiscardUnsavedDraft(): Promise<boolean> {
  return discardAsker ? discardAsker() : Promise.resolve(true);
}

/**
 * Runs a navigation action, first asking about unsaved drafts when any pane has
 * one. Synchronous call sites use it as `withDraftGuard(() => navigate())`.
 */
export function withDraftGuard(action: () => void): void {
  if (!hasAnyDirtyDraft()) {
    action();
    return;
  }
  void askDiscardUnsavedDraft().then((discard) => {
    if (!discard) return;
    discardAllDrafts();
    action();
  });
}
