// REDAX Team/Admin post-init mutation — the payer-cost ARITHMETIC, pure.
//
// The one place the post-init SOL requirement is summed, given the live rent floors the
// mutation root has just read. It reads no chain and holds no constant of its own: the
// root passes its audited constants in, so there is still exactly one set of numbers.
//
// THE METADATA CREATE FEE IS THE LARGER OF TWO MODELS (demo customer flow, 2026-10-22):
// the audited-source `rent(CREATE_FEE_SCALAR) + CREATE_FEE_OFFSET`, and the flat create fee
// observed on the deployed devnet runtime. At the old rent rate the two were equal (exactly
// 0.01 SOL); at today's lower rent rate the audited formula is smaller than what the deployed
// program actually levies, which made the preflight report "sufficient" for a payer that the
// transaction would then fail for. Taking the larger can only ask for more, never less.

export interface RedaxMutationSolModelInput {
  readonly operation:
    | 'ADD_TOKEN_CONFIG'
    | 'SETUP_METADATA'
    | 'ACTIVATE_CAMPAIGN'
    | 'PAUSE_CAMPAIGN'
    | 'UNPAUSE_CAMPAIGN'
    | 'FINALIZE_CAMPAIGN'
  /** The conservative per-transaction fee allowance every operation carries. */
  readonly feeBoundLamports: bigint
  /** The live rent-exempt minimum for each byte length the operation needs. */
  readonly rentBySpace: ReadonlyMap<number, bigint>
  /** The byte lengths whose rent is summed directly (payer floor, allocated accounts). */
  readonly allocatedSpaces: readonly number[]
  /** SETUP_METADATA only: the create fee's scaling byte length and flat terms. */
  readonly metadataCreateFee: {
    readonly scalarSpace: number
    readonly auditedOffsetLamports: bigint
    readonly observedFlatFeeLamports: bigint
  } | null
}

const U64_MAX = 18446744073709551615n

function checkedAdd(left: bigint, right: bigint): bigint | null {
  const sum = left + right
  return sum <= U64_MAX ? sum : null
}

/**
 * The estimated lamports one operation needs, or `null` when a rent is missing or the sum
 * would leave u64. A `null` WITHHOLDS the action — unknown is never sufficient.
 */
export function computeRedaxTeamAdminMutationRequiredLamports(
  input: RedaxMutationSolModelInput,
): bigint | null {
  let required: bigint | null = input.feeBoundLamports
  for (const space of input.allocatedSpaces) {
    const rent = input.rentBySpace.get(space)
    if (rent === undefined || rent <= 0n || required === null) {
      return null
    }
    required = checkedAdd(required, rent)
  }
  if (required === null) {
    return null
  }
  if (input.operation !== 'SETUP_METADATA') {
    return required
  }
  if (input.metadataCreateFee === null) {
    return null
  }
  const scalarRent = input.rentBySpace.get(input.metadataCreateFee.scalarSpace)
  if (scalarRent === undefined || scalarRent <= 0n) {
    return null
  }
  const audited = checkedAdd(scalarRent, input.metadataCreateFee.auditedOffsetLamports)
  if (audited === null) {
    return null
  }
  const createFee =
    audited > input.metadataCreateFee.observedFlatFeeLamports
      ? audited
      : input.metadataCreateFee.observedFlatFeeLamports
  return checkedAdd(required, createFee)
}
