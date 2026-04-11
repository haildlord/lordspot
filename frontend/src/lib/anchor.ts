import { Program, AnchorProvider, setProvider } from '@coral-xyz/anchor';
import { useConnection, useAnchorWallet } from '@solana/wallet-adapter-react';
import { useState, useEffect } from 'react';

const IDL = {
    "address": "9aURuK86pik3LVQT3nCEF466CfKcKVmNWiETkGegBjx7",
    "metadata": {
        "name": "lords_mock_usdc",
        "version": "0.1.0",
        "spec": "0.1.0",
        "description": "Created with Anchor"
    },
    "instructions": [
        {
            "name": "create_mock_usdc",
            "discriminator": [
                35,
                4,
                67,
                173,
                2,
                126,
                94,
                60
            ],
            "accounts": [
                {
                    "name": "signer",
                    "writable": true,
                    "signer": true
                },
                {
                    "name": "mint",
                    "writable": true,
                    "signer": true
                },
                {
                    "name": "mint_authority_pda",
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const",
                                "value": [
                                    109,
                                    105,
                                    110,
                                    116,
                                    95,
                                    97,
                                    117,
                                    116,
                                    104,
                                    111,
                                    114,
                                    105,
                                    116,
                                    121
                                ]
                            }
                        ]
                    }
                },
                {
                    "name": "metadata_account",
                    "writable": true,
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const",
                                "value": [
                                    109,
                                    101,
                                    116,
                                    97,
                                    100,
                                    97,
                                    116,
                                    97
                                ]
                            },
                            {
                                "kind": "account",
                                "path": "token_metadata_program"
                            },
                            {
                                "kind": "account",
                                "path": "mint"
                            }
                        ],
                        "program": {
                            "kind": "account",
                            "path": "token_metadata_program"
                        }
                    }
                },
                {
                    "name": "token_metadata_program",
                    "address": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
                },
                {
                    "name": "rent",
                    "address": "SysvarRent111111111111111111111111111111111"
                },
                {
                    "name": "token_program"
                },
                {
                    "name": "system_program",
                    "address": "11111111111111111111111111111111"
                }
            ],
            "args": []
        },
        {
            "name": "mint_mock_usdc",
            "discriminator": [
                168,
                64,
                97,
                102,
                69,
                152,
                108,
                251
            ],
            "accounts": [
                {
                    "name": "signer",
                    "writable": true,
                    "signer": true
                },
                {
                    "name": "mint",
                    "writable": true
                },
                {
                    "name": "destination",
                    "docs": [
                        "Anchor will initialize this as an ATA if it doesn't exist"
                    ],
                    "writable": true,
                    "pda": {
                        "seeds": [
                            {
                                "kind": "account",
                                "path": "signer"
                            },
                            {
                                "kind": "const",
                                "value": [
                                    6,
                                    221,
                                    246,
                                    225,
                                    215,
                                    101,
                                    161,
                                    147,
                                    217,
                                    203,
                                    225,
                                    70,
                                    206,
                                    235,
                                    121,
                                    172,
                                    28,
                                    180,
                                    133,
                                    237,
                                    95,
                                    91,
                                    55,
                                    145,
                                    58,
                                    140,
                                    245,
                                    133,
                                    126,
                                    255,
                                    0,
                                    169
                                ]
                            },
                            {
                                "kind": "account",
                                "path": "mint"
                            }
                        ],
                        "program": {
                            "kind": "const",
                            "value": [
                                140,
                                151,
                                37,
                                143,
                                78,
                                36,
                                137,
                                241,
                                187,
                                61,
                                16,
                                41,
                                20,
                                142,
                                13,
                                131,
                                11,
                                90,
                                19,
                                153,
                                218,
                                255,
                                16,
                                132,
                                4,
                                142,
                                123,
                                216,
                                219,
                                233,
                                248,
                                89
                            ]
                        }
                    }
                },
                {
                    "name": "mint_authority_pda",
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const",
                                "value": [
                                    109,
                                    105,
                                    110,
                                    116,
                                    95,
                                    97,
                                    117,
                                    116,
                                    104,
                                    111,
                                    114,
                                    105,
                                    116,
                                    121
                                ]
                            }
                        ]
                    }
                },
                {
                    "name": "token_program"
                },
                {
                    "name": "associated_token_program",
                    "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
                },
                {
                    "name": "system_program",
                    "address": "11111111111111111111111111111111"
                }
            ],
            "args": [
                {
                    "name": "amount",
                    "type": "u64"
                }
            ]
        }
    ],
    "errors": [
        {
            "code": 6000,
            "name": "InvalidMintAmount",
            "msg": "Amount must be > 0. Non-admins are limited to ≤ 10,000 USDC per transaction."
        }
    ]
} as any;

export const useAnchorProgram = () => {
    const { connection } = useConnection();
    const wallet = useAnchorWallet();
    const [program, setProgram] = useState<Program | null>(null);

    useEffect(() => {
        if (!wallet) {
            setProgram(null);
            return;
        }

        const initializeProgram = async () => {
            const provider = new AnchorProvider(
                connection,
                wallet,
                AnchorProvider.defaultOptions()
            );

            setProvider(provider);

            // ⚡ HACKATHON BYPASS: Calculate the Anchor 8-byte discriminator dynamically
            const encoder = new TextEncoder();
            const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode("global:mint_mock_usdc"));
            const discriminatorArray = Array.from(new Uint8Array(hashBuffer).slice(0, 8));

            // Inject the hash into the IDL so Anchor 0.30+ doesn't crash
            IDL.instructions[0].discriminator = discriminatorArray;

            setProgram(new Program(IDL, provider));
        };

        initializeProgram();
    }, [connection, wallet]);

    return { program };
};