// REDAX customer service — the bridge from a verified session to the existing Team/Admin roots.
//
// THE BUILD-TIME TEAM ADDRESS IS NO LONGER THE POSITIVE IDENTITY. The S1 root (and, inside the
// workspace, the mutation root) now receive the wallet the customer service verified by SIWS
// AND that is connected right now — `useRedaxCustomerSession().teamWallet` — or `null`. That one
// value is the positive identity for chain guards, recovery and status checks alike.
//
// ACCESS NEVER NULLS THE IDENTITY. A customer whose access was set to STOP_NEW keeps the same
// positive identity, so recovery, status checks and management of their own campaigns keep
// working; what STOP_NEW closes is decided per operation by the write gate at the root boundary
// (and again by the server), never by blanking the wallet.
//
// The roots themselves are unchanged in what they can do. This bridge adds no signer, no
// sender and no journal; it only supplies the identity and the write gate.
//
// A COORDINATOR LIVES EXACTLY AS LONG AS ITS SESSION. It is bound to the live session it was
// created under, and the one it replaces is disposed when the new one is committed — anything
// it had armed, scoped or admitted is void from then on. Disposal is tied to that REPLACEMENT,
// not to an effect cleanup: React's development StrictMode runs every cleanup once on a
// simulated re-mount, which would otherwise leave the live coordinator disposed for good. This
// bridge wraps the whole app shell, so it is not unmounted while the page lives.

import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { RedaxTeamAdminActionsProvider } from '../teamAdmin/RedaxTeamAdminActions'
import { useRedaxCustomerSession } from './CustomerSessionProvider'
import {
  REDAX_CUSTOMER_REFUSING_S1_GATE,
  createRedaxCustomerTeamWriteCoordinator,
  type RedaxCustomerTeamWriteCoordinator,
} from './customerTeamWrites'

const RedaxCustomerTeamWritesContext = createContext<RedaxCustomerTeamWriteCoordinator | null>(null)

export function useRedaxCustomerTeamWrites(): RedaxCustomerTeamWriteCoordinator | null {
  return useContext(RedaxCustomerTeamWritesContext)
}

export function RedaxCustomerTeamRoots({
  runtimeProgramId,
  children,
}: {
  /** The app's one canonical runtime program id (public deployment fact), or `null`. */
  readonly runtimeProgramId: string | null
  readonly children?: ReactNode
}) {
  const session = useRedaxCustomerSession()
  const servicesProgramId = session.state.status === 'signed-in' ? session.state.config.programId : null
  const teamWallet = session.teamWallet
  // The service and the bundle must name the SAME program, or no write is coordinated at all.
  const programAgrees = runtimeProgramId !== null && servicesProgramId === runtimeProgramId
  const coordinator = useMemo(
    () =>
      teamWallet !== null && programAgrees && runtimeProgramId !== null
        ? createRedaxCustomerTeamWriteCoordinator({
            api: session.api,
            teamWallet,
            programId: runtimeProgramId,
            readLiveSession: session.readLive,
          })
        : null,
    // A new session epoch is a new coordinator: nothing armed under the previous identity survives.
    [programAgrees, runtimeProgramId, session.api, session.epoch, session.readLive, teamWallet],
  )
  const committedRef = useRef<RedaxCustomerTeamWriteCoordinator | null>(null)
  useEffect(() => {
    const previous = committedRef.current
    committedRef.current = coordinator
    if (previous !== null && previous !== coordinator) {
      previous.dispose()
    }
  }, [coordinator])
  return (
    <RedaxCustomerTeamWritesContext.Provider value={coordinator}>
      <RedaxTeamAdminActionsProvider
        approvedTeamWallet={coordinator === null ? null : teamWallet}
        writeGate={coordinator?.s1Gate ?? REDAX_CUSTOMER_REFUSING_S1_GATE}
      >
        {children}
      </RedaxTeamAdminActionsProvider>
    </RedaxCustomerTeamWritesContext.Provider>
  )
}
