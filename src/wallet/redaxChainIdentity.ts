// REDAX chain identity — the two source-pinned identities the Holder chain guard
// checks against, and nothing else.
//
// Boundary: this module is pure. It performs no RPC, opens no Connection, touches
// no wallet, renders no UI, persists nothing, reads no environment, reads no
// clock, generates no entropy, holds no mutable cache, and logs nothing. It
// imports exactly one symbol (`PublicKey`) from the already-installed
// `@solana/web3.js`.
//
// WHY THE IDENTITIES ARE PRIVATE. Both values below are public chain data, not
// secrets — but they are the *authority* the guard compares live observations
// against, so this module exposes only the two equality questions and never the
// values themselves. There is deliberately no raw string export, no raw
// `PublicKey` export, no byte export and no diagnostic accessor: a caller can ask
// "is this the expected identity?" and can learn nothing else. That keeps the
// answer un-forgeable from outside and keeps raw identities out of every result,
// error and log in the wallet layer.
//
// -----------------------------------------------------------------------------
// PROVENANCE — devnet genesis
// -----------------------------------------------------------------------------
// repository : anza-xyz/agave
// ref        : v2.1.0
// path       : docs/src/clusters/available.md
// section    : Devnet  (`--expected-genesis-hash`)
// fingerprint: 59017c3f   (sha256_8 over the base58-decoded 32 raw bytes)
//
// Fresh live equality is still REQUIRED at every guard phase. This constant is
// the expectation, never the observation.
//
// -----------------------------------------------------------------------------
// PROVENANCE — standard BPF Upgradeable Loader
// -----------------------------------------------------------------------------
// repository : anza-xyz/solana-sdk
// ref        : 4fb3a9a3962829e058e920df7c847da9f3589d96
// path       : sdk-ids/src/lib.rs
// declaration: pub mod bpf_loader_upgradeable { declare_id!(..) }
// fingerprint: 2dbc6f75   (sha256_8 over the base58-decoded 32 raw bytes)
//
// Fresh accepted-program-owner equality is still REQUIRED at every guard phase.
//
// -----------------------------------------------------------------------------
// WHY THIS CONSTANT IS PROJECT-OWNED (and what may NEVER substitute for it)
// -----------------------------------------------------------------------------
// The installed browser stack exports NO upgradeable-loader identity. It exports
// only NON-UPGRADEABLE / DEPRECATED loader identities, and they are different
// keys:
//
//   * BPF_LOADER_PROGRAM_ID            is NOT a substitute (fingerprint d1cd1db2)
//   * BPF_LOADER_DEPRECATED_PROGRAM_ID is NOT a substitute (fingerprint 9b9abe6c)
//
// Neither may be used as the upgradeable-loader identity, and no other
// non-upgradeable or deprecated loader identity may substitute either. Swapping
// one in would make the owner check pass against the wrong loader class and
// silently destroy the guarantee this module exists to provide.
//
// A STATE-LAYOUT DECODER IS NOT AN IDENTITY CONSTANT. `@coral-xyz/anchor` ships
// `decodeUpgradeableLoaderState`, which parses the loader's account layout. It
// tells you how to read the bytes; it does not tell you who owns them. It may not
// stand in for the identity below.
//
// No guessed value. No installed-export substitution. No environment override
// (there is deliberately no env read in this file). No endpoint-derived identity:
// an endpoint is a string a caller controls, so it can never establish which
// chain it actually points at — only a fresh live genesis comparison can.
//
// Verified by tests through source parsing and fingerprint comparison only; the
// raw literals are never printed by a test, a report or this module.

import { PublicKey } from '@solana/web3.js'

/**
 * The only text this module ever throws. It carries no raw value, so a malformed
 * checked-in constant cannot leak its own bytes through an error path.
 */
const REDAX_CHAIN_IDENTITY_CONSTANT_INVALID = 'REDAX_CHAIN_IDENTITY_CONSTANT_INVALID'

/**
 * Validate a checked-in identity literal as a canonical 32-byte base58 identity
 * at module initialization.
 *
 * `new PublicKey(value)` rejects anything that is not base58 or does not decode
 * to exactly 32 bytes. The round-trip re-encode additionally rejects a
 * non-canonical spelling of an otherwise valid key, so the literal in source is
 * exactly the literal the comparison uses.
 *
 * This can only fail if a checked-in constant is edited to something malformed —
 * which is precisely when failing loudly (and value-free) is correct.
 */
function requireCanonicalIdentityBase58(value: string): PublicKey {
  let identity: PublicKey
  try {
    identity = new PublicKey(value)
  } catch {
    throw new Error(REDAX_CHAIN_IDENTITY_CONSTANT_INVALID)
  }
  if (identity.toBase58() !== value) {
    throw new Error(REDAX_CHAIN_IDENTITY_CONSTANT_INVALID)
  }
  return identity
}

// --- Source-pinned identities (MODULE-PRIVATE; never exported) ---------------

const REDAX_EXPECTED_DEVNET_GENESIS_HASH_BASE58 = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'

const REDAX_EXPECTED_UPGRADEABLE_LOADER_PROGRAM_ID_BASE58 = 'BPFLoaderUpgradeab1e11111111111111111111111'

/**
 * The expected devnet genesis hash, kept as its canonical base58 text because
 * `Connection.getGenesisHash()` returns base58 text: comparing text to text is
 * exact and needs no normalization step that could be tricked.
 */
const REDAX_EXPECTED_DEVNET_GENESIS_HASH: string = requireCanonicalIdentityBase58(
  REDAX_EXPECTED_DEVNET_GENESIS_HASH_BASE58,
).toBase58()

/**
 * The expected standard BPF Upgradeable Loader identity, kept as a `PublicKey`
 * because an account's `owner` is a `PublicKey`: comparing key to key with
 * `PublicKey.equals` avoids any string-form ambiguity.
 */
const REDAX_EXPECTED_UPGRADEABLE_LOADER_PROGRAM_ID: PublicKey = requireCanonicalIdentityBase58(
  REDAX_EXPECTED_UPGRADEABLE_LOADER_PROGRAM_ID_BASE58,
)

// --- The entire public surface: two equality questions -----------------------

/**
 * Is `candidate` exactly the expected devnet genesis hash?
 *
 * Exact and normalization-free: no trim, no case folding, no re-encode. Anything
 * that is not character-for-character the expected canonical base58 text — a
 * different cluster, a truncated value, an empty string, whitespace — is simply
 * `false`. It never throws and never reveals what was expected.
 */
export function isRedaxExpectedDevnetGenesisHash(candidate: string): boolean {
  return candidate === REDAX_EXPECTED_DEVNET_GENESIS_HASH
}

/**
 * Is `candidate` exactly the expected standard BPF Upgradeable Loader identity?
 *
 * This is the check that proves the accepted program account is owned by the
 * upgradeable loader and not by some other loader class or program. A malformed
 * or absent candidate takes the fixed `false` path rather than throwing, so a
 * hostile or broken value can never turn a refusal into an exception the caller
 * might mishandle.
 */
export function isRedaxExpectedUpgradeableLoaderOwner(candidate: PublicKey): boolean {
  try {
    return REDAX_EXPECTED_UPGRADEABLE_LOADER_PROGRAM_ID.equals(candidate)
  } catch {
    return false
  }
}
