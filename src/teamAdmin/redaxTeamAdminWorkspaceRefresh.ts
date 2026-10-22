// REDAX Team/Admin workspace refresh — bounded, event-sourced, read-only coordination.
//
// WHAT IT ADDS (demo customer flow, 2026-10-22). After a VERIFIED mutation terminal, or
// when the person presses the one "Check and refresh" control, every Team/Admin panel of
// the selected campaign runs a READ-ONLY check — read its saved attempt back, then read
// fresh chain truth — exactly once, one panel at a time. The earlier rule "a panel reads
// fresh state only from its own click" is superseded on that point only: a verified result
// in one panel no longer leaves the others on a stale snapshot, and the person has one
// obvious control instead of four.
//
// WHAT IT DOES NOT ADD. No reconcile: resolving a saved attempt moves the durable record,
// and that stays each panel's explicit "Check status" click. No timer, no interval, no
// polling, no subscription, no websocket and no retry. No sign, no send, no wallet prompt,
// no new attempt, no journal write and no new storage. A request is a counter bump and a
// campaign id. A panel that is busy keeps the newest request pending and runs it once when it
// is free; a request for a campaign the panel no longer shows is dropped.
// Every guard the panels apply before a submit is unchanged: a fresh reading here is
// display truth and never write permission.

import { useEffect, useLayoutEffect, useRef } from 'react'

/** One workspace-wide check request: run once per new sequence, for this campaign only. */
export interface RedaxTeamAdminWorkspaceCheckRequest {
  readonly campaignId: string
  readonly sequence: number
}

/**
 * The submit / reconcile codes that mean a mutation was VERIFIED and RESOLVED just now.
 * Only these raise a refresh event; an already-resolved, pending, unreadable or refused
 * answer never does — which is what keeps one event from chaining into another.
 */
const VERIFIED_RESOLUTION_CODES: readonly string[] = Object.freeze([
  'MATCHING_IMMEDIATE_STATE_RESOLVED',
  'LANDED_EXACT_POST_STATE_SUPERSEDED_RESOLVED',
])

export function isRedaxTeamAdminVerifiedResolutionCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && VERIFIED_RESOLUTION_CODES.includes(code)
}

/**
 * ONE PANEL AT A TIME. Each panel's status gesture reconciles the same single durable
 * mutation slot under a non-queueing lock, so four gestures started together would mostly
 * be refused as "busy". Chaining them here makes a workspace check run them in sequence; a
 * gesture's own failure never breaks the chain for the next one.
 */
let statusGestureChain: Promise<unknown> = Promise.resolve()

export function runRedaxTeamAdminStatusGestureSerialized<T>(gesture: () => Promise<T>): Promise<T> {
  const next = statusGestureChain.then(gesture, gesture)
  statusGestureChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

/**
 * Run the panel's READ-ONLY check once for the NEWEST request that names its selected
 * campaign — as soon as the panel is free.
 *
 * A request counts as handled only when the check actually STARTED: `readOnlyCheck` claims the
 * panel's own latch and returns `true`, or returns `false` without reading when the latch is
 * taken. While the panel is `busy` a request stays pending; when `busy` clears this effect runs
 * again and starts at most ONE read, for the newest pending sequence — earlier sequences that
 * arrived meanwhile are covered by it, so a burst never becomes a queue of reads.
 *
 * A request for another campaign — including one still pending when the selection changed — is
 * dropped, never replayed on the newly selected campaign. A request that existed before the
 * panel mounted is treated as already handled, so a remount never replays an old event.
 */
export function useRedaxTeamAdminWorkspaceCheck(
  request: RedaxTeamAdminWorkspaceCheckRequest | null | undefined,
  selectedCampaignId: string,
  busy: boolean,
  readOnlyCheck: () => boolean,
): void {
  const checkRef = useRef(readOnlyCheck)
  const handledRef = useRef<number>(request?.sequence ?? 0)
  useLayoutEffect(() => {
    checkRef.current = readOnlyCheck
  }, [readOnlyCheck])
  useEffect(() => {
    if (request === null || request === undefined || request.sequence <= handledRef.current) {
      return
    }
    if (request.campaignId !== selectedCampaignId || selectedCampaignId === '') {
      // Never run later for a different campaign: the request is closed here, unread.
      handledRef.current = request.sequence
      return
    }
    if (busy) {
      // Still pending. `busy` is a dependency, so the panel becoming free runs this again.
      return
    }
    const runWorkspaceReadOnlyCheck = checkRef.current
    if (runWorkspaceReadOnlyCheck()) {
      handledRef.current = request.sequence
    }
  }, [request, selectedCampaignId, busy])
}
