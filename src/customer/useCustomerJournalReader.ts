// REDAX customer service — this browser's Team/Admin journal state, read through the roots.
//
// The two durable journals are read ONLY through the transaction roots' own read-only members
// (`readRecoveryRecord` on the S1 root, `readMutationStatus` on the mutation root), so the
// customer layer imports no journal module and gains no storage capability. Unreadable is
// `UNKNOWN`, never idle: an unknown journal keeps the sticky claim.

import { useCallback } from 'react'
import { useRedaxTeamAdminActions } from '../teamAdmin/RedaxTeamAdminActions'
import { useRedaxTeamAdminMutationActions } from '../teamAdmin/RedaxTeamAdminMutationActions'
import type { RedaxCustomerJournalReader } from './customerTeamWrites'

export function useCustomerJournalReader(programId: string | null, teamWallet: string | null): RedaxCustomerJournalReader {
  const s1 = useRedaxTeamAdminActions()
  const mutation = useRedaxTeamAdminMutationActions()
  return useCallback(async () => {
    if (programId === null || teamWallet === null) {
      return { s1: 'UNKNOWN', mutation: 'UNKNOWN' }
    }
    const [record, status] = await Promise.all([
      s1.readRecoveryRecord({ cluster: 'devnet', program: programId, teamWallet }),
      mutation.readMutationStatus(),
    ])
    return {
      s1: !record.ok ? 'UNKNOWN' : record.kind === 'ACTIVE' ? 'ACTIVE' : 'IDLE',
      mutation: !status.ok ? 'UNKNOWN' : status.presence === 'ACTIVE' ? 'ACTIVE' : 'IDLE',
    }
  }, [mutation, programId, s1, teamWallet])
}
