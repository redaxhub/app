/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/redax_protocol.json`.
 */
export type RedaxProtocol = {
  "address": "7SGcKGsE5tRCFcWFq7jK4P3yPc2EcGiFidtS4hwJEQgd",
  "metadata": {
    "name": "redaxProtocol",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "REDAX Phase 1 protocol program for classic SPL conversion flows"
  },
  "instructions": [
    {
      "name": "activateCampaign",
      "discriminator": [
        17,
        214,
        3,
        27,
        91,
        67,
        44,
        171
      ],
      "accounts": [
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.output_governance",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.salt",
                "account": "campaign"
              }
            ]
          }
        },
        {
          "name": "campaignAdmin",
          "signer": true,
          "relations": [
            "campaign"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "addTokenConfig",
      "discriminator": [
        138,
        17,
        119,
        191,
        118,
        60,
        75,
        230
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "campaignAdmin",
          "signer": true,
          "relations": [
            "campaign"
          ]
        },
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.output_governance",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.salt",
                "account": "campaign"
              }
            ]
          }
        },
        {
          "name": "legacyMint",
          "docs": [
            "of the Solana account owner (must equal `CLASSIC_SPL_TOKEN_PROGRAM_ID`),",
            "data length (exactly 82 bytes), `is_initialized` flag, and decimals byte",
            "(offset 44, via `spl_compat::classic_mint_decimals`) is performed in the",
            "handler body per L3E-3B5A LC-A / LC-B. `legacy_mint` participates in the",
            "`token_config` PDA derivation via `legacy_mint.key()`."
          ]
        },
        {
          "name": "outputMint",
          "docs": [
            "`campaign.output_mint`; manual validation of the Solana account owner",
            "(must equal `CLASSIC_SPL_TOKEN_PROGRAM_ID`), data length (exactly 82",
            "bytes), `is_initialized` flag, and decimals byte (offset 44, via",
            "`spl_compat::classic_mint_decimals`) is performed in the handler body",
            "per L3E-3B5A LC-C."
          ]
        },
        {
          "name": "tokenConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "campaign"
              },
              {
                "kind": "account",
                "path": "legacyMint"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "rateNumerator",
          "type": "u128"
        },
        {
          "name": "rateDenominator",
          "type": "u128"
        },
        {
          "name": "maxOutputFromTc",
          "type": "u128"
        }
      ]
    },
    {
      "name": "convertExactIn",
      "discriminator": [
        15,
        209,
        11,
        216,
        241,
        255,
        120,
        118
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.output_governance",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.salt",
                "account": "campaign"
              }
            ]
          },
          "relations": [
            "tokenConfig"
          ]
        },
        {
          "name": "tokenConfig",
          "writable": true
        },
        {
          "name": "legacyMint",
          "docs": [
            "later `Burn` decrements its supply. Validated in the handler (L3E-3B12F):",
            "Solana account owner == `CLASSIC_SPL_TOKEN_PROGRAM_ID`, exact 82-byte",
            "classic `Mint` layout, `is_initialized`, key == `token_config.legacy_mint`,",
            "decimals == `token_config.legacy_decimals`."
          ],
          "writable": true
        },
        {
          "name": "outputMint",
          "docs": [
            "later `MintTo` increments its supply. Validated in the handler",
            "(L3E-3B12F): Solana account owner == `CLASSIC_SPL_TOKEN_PROGRAM_ID`, exact",
            "82-byte classic `Mint` layout, `is_initialized`, key == `campaign.output_mint`,",
            "`mint_authority == Some(campaign.key())`, `freeze_authority == None`. No",
            "metadata behavior."
          ],
          "writable": true
        },
        {
          "name": "userLegacyAta",
          "docs": [
            "because it is the source of the later `Burn`. Validated in the handler",
            "(L3E-3B12F): Solana account owner == `CLASSIC_SPL_TOKEN_PROGRAM_ID`, exact",
            "165-byte classic `TokenAccount` layout, `is_initialized`, `mint` field ==",
            "`legacy_mint`, token `owner` field == `user` (owner mismatch ->",
            "`Unauthorized`)."
          ],
          "writable": true
        },
        {
          "name": "userOutputAta",
          "docs": [
            "`mut` because the later `MintTo` credits it. It MUST already exist — no",
            "`init`, no `init_if_needed`, no ATA creation here (`prepare_user_output_ata`",
            "creates it; convert rejects a missing ATA per DL-009). Validated in the",
            "handler (L3E-3B12F): address == canonical ATA for `(user,",
            "CLASSIC_SPL_TOKEN_PROGRAM_ID, output_mint)`, account data non-empty,",
            "Solana account owner == `CLASSIC_SPL_TOKEN_PROGRAM_ID`, exact 165-byte",
            "classic `TokenAccount` layout, `is_initialized`, `mint` field ==",
            "`output_mint`, token `owner` field == `user`."
          ],
          "writable": true
        },
        {
          "name": "protocolFeeVault",
          "docs": [
            "`MintTo` credits it. Validated in the handler (L3E-3B12F): key ==",
            "`campaign.protocol_fee_vault`, Solana account owner ==",
            "`CLASSIC_SPL_TOKEN_PROGRAM_ID`, exact 165-byte classic `TokenAccount`",
            "layout, `is_initialized`, `mint` field == `output_mint`, token `owner`",
            "field == `protocol_config.protocol_fee_authority` — the Campaign PDA is",
            "NOT its authority and never transfers out of it. No transfer/drain",
            "behavior."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "docs": [
            "pre-Token-2022 SPL Token program) — pinned in the handler (L3E-3B12F);",
            "rejects Token-2022. Mirrors the `token_program` handling in",
            "`prepare_user_output_ata`. No new dependency."
          ]
        }
      ],
      "args": [
        {
          "name": "amountIn",
          "type": "u64"
        }
      ]
    },
    {
      "name": "finalizeCampaign",
      "discriminator": [
        241,
        76,
        201,
        221,
        33,
        222,
        220,
        138
      ],
      "accounts": [
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.output_governance",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.salt",
                "account": "campaign"
              }
            ]
          }
        },
        {
          "name": "campaignAdmin",
          "signer": true,
          "relations": [
            "campaign"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "initCampaign",
      "discriminator": [
        154,
        188,
        249,
        244,
        226,
        210,
        253,
        109
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "outputGovernance",
          "signer": true
        },
        {
          "name": "campaignAdmin",
          "signer": true
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "outputGovernance"
              },
              {
                "kind": "arg",
                "path": "salt"
              }
            ]
          }
        },
        {
          "name": "outputMint",
          "docs": [
            "the caller / setup flow before this instruction executes (DL-014) and",
            "validated — never created — here. Manual validation of the account",
            "owner (classic SPL Token program ID), data length (82 bytes),",
            "is_initialized, mint_authority (must equal the exact Campaign PDA),",
            "freeze_authority (must be None), decimals (must equal",
            "OUTPUT_MINT_DECIMALS = 9) and supply (must be zero) is performed in the",
            "handler body per L3E-3B3A LC-1, L3E-3B3C1 §2, and DL-015 (canonical",
            "spec v1.4 §6)."
          ]
        },
        {
          "name": "protocolFeeVault",
          "docs": [
            "protocol_fee_authority owner over the output_mint. Manual ATA",
            "derivation (Pubkey::find_program_address against the classic SPL",
            "Token program and the Associated Token Program), data length (165",
            "bytes), state, mint, and owner validation are performed in the",
            "handler body per L3E-3B3A LC-2 and L3E-3B3C1 §3/§4."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "salt",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "endTs",
          "type": {
            "option": "i64"
          }
        },
        {
          "name": "maxOutputSupply",
          "type": "u128"
        }
      ]
    },
    {
      "name": "initProtocol",
      "discriminator": [
        3,
        188,
        141,
        237,
        225,
        226,
        232,
        210
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocolConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "protocolFeeAuthority",
          "type": "pubkey"
        },
        {
          "name": "protocolEmergencyPauseAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "pauseCampaign",
      "discriminator": [
        62,
        247,
        54,
        192,
        240,
        158,
        8,
        161
      ],
      "accounts": [
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.output_governance",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.salt",
                "account": "campaign"
              }
            ]
          }
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "prepareUserOutputAta",
      "discriminator": [
        238,
        48,
        109,
        185,
        85,
        209,
        62,
        211
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "campaign",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.output_governance",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.salt",
                "account": "campaign"
              }
            ]
          }
        },
        {
          "name": "user"
        },
        {
          "name": "outputMint"
        },
        {
          "name": "userOutputAta",
          "writable": true
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "setupMetadata",
      "discriminator": [
        33,
        141,
        154,
        228,
        169,
        204,
        90,
        181
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "campaignAdmin",
          "signer": true,
          "relations": [
            "campaign"
          ]
        },
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.output_governance",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.salt",
                "account": "campaign"
              }
            ]
          }
        },
        {
          "name": "outputMint"
        },
        {
          "name": "metadataAccount",
          "writable": true
        },
        {
          "name": "metadataProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "symbol",
          "type": "string"
        },
        {
          "name": "uri",
          "type": "string"
        }
      ]
    },
    {
      "name": "unpauseCampaign",
      "discriminator": [
        177,
        111,
        91,
        206,
        169,
        242,
        87,
        95
      ],
      "accounts": [
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.output_governance",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.salt",
                "account": "campaign"
              }
            ]
          }
        },
        {
          "name": "campaignAdmin",
          "signer": true,
          "relations": [
            "campaign"
          ]
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "campaign",
      "discriminator": [
        50,
        40,
        49,
        11,
        157,
        220,
        229,
        192
      ]
    },
    {
      "name": "protocolConfig",
      "discriminator": [
        207,
        91,
        250,
        28,
        152,
        179,
        215,
        209
      ]
    },
    {
      "name": "tokenConfig",
      "discriminator": [
        92,
        73,
        255,
        43,
        107,
        51,
        117,
        101
      ]
    }
  ],
  "events": [
    {
      "name": "converted",
      "discriminator": [
        48,
        254,
        146,
        135,
        50,
        134,
        136,
        167
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "protocolConfigNotInitialized",
      "msg": "Protocol config account is not initialized"
    },
    {
      "code": 6001,
      "name": "campaignNotActive",
      "msg": "Campaign is not in Active status"
    },
    {
      "code": 6002,
      "name": "metadataNotSet",
      "msg": "Campaign metadata is not set"
    },
    {
      "code": 6003,
      "name": "metadataAlreadySet",
      "msg": "Campaign metadata is already set"
    },
    {
      "code": 6004,
      "name": "wrongCampaignStatus",
      "msg": "Campaign is not in the expected status for this transition"
    },
    {
      "code": 6005,
      "name": "wrongTokenConfig",
      "msg": "Provided token config does not belong to this campaign"
    },
    {
      "code": 6006,
      "name": "wrongLegacyMint",
      "msg": "Provided legacy mint does not match the token config"
    },
    {
      "code": 6007,
      "name": "wrongOutputMint",
      "msg": "Provided output mint does not match the campaign"
    },
    {
      "code": 6008,
      "name": "outputMintAuthorityMismatch",
      "msg": "Output mint authority does not match the campaign PDA"
    },
    {
      "code": 6009,
      "name": "freezeAuthorityNotNone",
      "msg": "Output mint freeze authority must be None"
    },
    {
      "code": 6010,
      "name": "wrongUserLegacyAta",
      "msg": "Provided user legacy ATA does not match user and legacy mint"
    },
    {
      "code": 6011,
      "name": "wrongUserOutputAta",
      "msg": "Provided user output ATA does not match user and output mint"
    },
    {
      "code": 6012,
      "name": "userOutputAtaNonCanonical",
      "msg": "User output ATA is not the canonical associated token account"
    },
    {
      "code": 6013,
      "name": "userOutputAtaNotFound",
      "msg": "User output ATA does not exist"
    },
    {
      "code": 6014,
      "name": "wrongProtocolFeeVault",
      "msg": "Provided protocol fee vault does not match the campaign"
    },
    {
      "code": 6015,
      "name": "wrongProtocolFeeVaultMint",
      "msg": "Protocol fee vault mint does not match the output mint"
    },
    {
      "code": 6016,
      "name": "wrongProtocolFeeVaultAuthority",
      "msg": "Protocol fee vault owner is not the protocol fee authority"
    },
    {
      "code": 6017,
      "name": "aliasedAccounts",
      "msg": "Two or more accounts that must be distinct were aliased"
    },
    {
      "code": 6018,
      "name": "wrongTokenProgram",
      "msg": "Token program does not match the canonical SPL Token program"
    },
    {
      "code": 6019,
      "name": "unauthorized",
      "msg": "Caller is not authorized for this operation"
    },
    {
      "code": 6020,
      "name": "wrongMetadataProgram",
      "msg": "Metadata program does not match the canonical Metaplex Token Metadata program"
    },
    {
      "code": 6021,
      "name": "wrongMetadataAccount",
      "msg": "Metadata account does not match the expected derivation"
    },
    {
      "code": 6022,
      "name": "metadataLengthOutOfBounds",
      "msg": "Metadata name, symbol, or uri exceeds the configured length bound"
    },
    {
      "code": 6023,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6024,
      "name": "zeroGrossOut",
      "msg": "Computed gross output is zero"
    },
    {
      "code": 6025,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6026,
      "name": "mathUnderflow",
      "msg": "Arithmetic underflow"
    },
    {
      "code": 6027,
      "name": "conversionTruncationLoss",
      "msg": "Conversion would lose precision below configured tolerance"
    },
    {
      "code": 6028,
      "name": "invalidRate",
      "msg": "Configured rate is invalid"
    },
    {
      "code": 6029,
      "name": "capExceededCampaign",
      "msg": "Campaign cap would be exceeded by this conversion"
    },
    {
      "code": 6030,
      "name": "capExceededTokenConfig",
      "msg": "Token config cap would be exceeded by this conversion"
    },
    {
      "code": 6031,
      "name": "tooManyTokenConfigs",
      "msg": "Adding this token config would exceed MAX_TOKEN_CONFIGS_PER_CAMPAIGN"
    },
    {
      "code": 6032,
      "name": "campaignExpired",
      "msg": "Campaign has expired"
    },
    {
      "code": 6033,
      "name": "invalidCampaignDeadline",
      "msg": "Invalid campaign deadline"
    },
    {
      "code": 6034,
      "name": "outputMintDecimalsMismatch",
      "msg": "Output mint decimals must equal 9"
    },
    {
      "code": 6035,
      "name": "outputMintSupplyNotZero",
      "msg": "Output mint supply must be zero"
    }
  ],
  "types": [
    {
      "name": "campaign",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaignAdmin",
            "type": "pubkey"
          },
          {
            "name": "outputGovernance",
            "type": "pubkey"
          },
          {
            "name": "outputMint",
            "type": "pubkey"
          },
          {
            "name": "protocolFeeVault",
            "type": "pubkey"
          },
          {
            "name": "metadataSetup",
            "type": "bool"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "campaignStatus"
              }
            }
          },
          {
            "name": "discoveryStatus",
            "type": "u8"
          },
          {
            "name": "tokenConfigCount",
            "type": "u16"
          },
          {
            "name": "totalOutputMinted",
            "type": "u128"
          },
          {
            "name": "totalProtocolFeesMinted",
            "type": "u128"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "salt",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "endTs",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "maxOutputSupply",
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "campaignStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "initialized"
          },
          {
            "name": "active"
          },
          {
            "name": "paused"
          },
          {
            "name": "finalized"
          }
        ]
      }
    },
    {
      "name": "converted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaign",
            "type": "pubkey"
          },
          {
            "name": "tokenConfig",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "legacyMint",
            "type": "pubkey"
          },
          {
            "name": "outputMint",
            "type": "pubkey"
          },
          {
            "name": "amountIn",
            "type": "u64"
          },
          {
            "name": "amountInNormalized",
            "type": "u128"
          },
          {
            "name": "normalizationRemainder",
            "type": "u128"
          },
          {
            "name": "grossOut",
            "type": "u128"
          },
          {
            "name": "userOut",
            "type": "u128"
          },
          {
            "name": "feeOut",
            "type": "u128"
          },
          {
            "name": "userOutputAta",
            "type": "pubkey"
          },
          {
            "name": "protocolFeeVault",
            "type": "pubkey"
          },
          {
            "name": "campaignTotalOutputMintedAfter",
            "type": "u128"
          },
          {
            "name": "campaignTotalProtocolFeesMintedAfter",
            "type": "u128"
          },
          {
            "name": "tokenConfigTotalOutputMintedFromTcAfter",
            "type": "u128"
          },
          {
            "name": "tokenConfigNormalizationRemainderTotalAfter",
            "type": "u128"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "protocolConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "protocolFeeAuthority",
            "type": "pubkey"
          },
          {
            "name": "protocolEmergencyPauseAuthority",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "tokenConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaign",
            "type": "pubkey"
          },
          {
            "name": "legacyMint",
            "type": "pubkey"
          },
          {
            "name": "rateNumerator",
            "type": "u128"
          },
          {
            "name": "rateDenominator",
            "type": "u128"
          },
          {
            "name": "legacyDecimals",
            "type": "u8"
          },
          {
            "name": "outputDecimals",
            "type": "u8"
          },
          {
            "name": "totalOutputMintedFromTc",
            "type": "u128"
          },
          {
            "name": "normalizationRemainderTotal",
            "type": "u128"
          },
          {
            "name": "maxOutputFromTc",
            "type": "u128"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
