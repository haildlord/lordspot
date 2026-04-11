import { Program, AnchorProvider, setProvider } from '@coral-xyz/anchor';
import { useConnection, useAnchorWallet } from '@solana/wallet-adapter-react';
import { useState, useEffect } from 'react';

const IDL = {
  address: "9aURuK86pik3LVQT3nCEF466CfKcKVmNWiETkGegBjx7",
  metadata: { address: "9aURuK86pik3LVQT3nCEF466CfKcKVmNWiETkGegBjx7" },
  version: "0.1.0",
  name: "lords_mock_usdc",
  instructions: [
    {
      name: "mintMockUsdc",
      // Discriminator will be injected dynamically below
      accounts: [
        { name: "signer", isMut: true, isSigner: true },
        { name: "mint", isMut: true, isSigner: false },
        { name: "destination", isMut: true, isSigner: false },
        { name: "mintAuthorityPda", isMut: false, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
        { name: "associatedTokenProgram", isMut: false, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false }
      ],
      args: [
        { name: "amount", type: "u64" }
      ]
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