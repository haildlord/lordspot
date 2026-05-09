import { PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import {getLpInfoPda, getPerEpochStatePda} from "../utility/seeds_and_ata.ts";

const PRECISE_UNIT = 1_000_000_000_000;

export interface TrueLpState {
    consolidatedShares: number;
    claimableUsdc: number;
    pendingWithdrawalShares: number;
    pendingWithdrawalEpoch: number;

    lastDepositAmount: number;
    lastDepositEpoch: number;

    rawPendingDepositAmount: number;
    rawLastDepositEpoch: number;
}

export const calculateTrueLpState = async (
    program: Program<any>,
    userPubkey: PublicKey,
    currentEpochId: number
): Promise<TrueLpState | null> => {

    let lpPda = getLpInfoPda(userPubkey)[0];

    let rawLpInfo;
    try {
        rawLpInfo = await program.account.lpInfo.fetch(lpPda);
    } catch (e) {
        return null;
    }

    let trueConsolidatedShares = rawLpInfo.consolidatedShares.toNumber();
    let trueClaimableUsdc = rawLpInfo.claimableWithdrawals.toNumber();

    const rawPendingDepositAmount = rawLpInfo.lastDepositInfo.amount.toNumber();
    const rawLastDepositEpoch = rawLpInfo.lastDepositInfo.epochId.toNumber();

    let displayPendingDepositAmount = rawPendingDepositAmount;
    const lastDepositEpoch = rawLastDepositEpoch;

    let displayPendingWithdrawalShares = rawLpInfo.withdrawalInfo.amountInShares.toNumber();
    const pendingWithdrawalEpoch = rawLpInfo.withdrawalInfo.epochId.toNumber();

    if (displayPendingDepositAmount > 0 && lastDepositEpoch < currentEpochId) {
        const [depositEpochPda] = getPerEpochStatePda(lastDepositEpoch);

        let depositSharesPercentage = PRECISE_UNIT;
        try {
            const depositEpochState = await program.account.perEpochState.fetch(depositEpochPda);
            depositSharesPercentage = depositEpochState.sharesPercentage.toNumber();
        } catch (e) {
            console.log(e);
            console.warn(`RPC Delay on Deposit Epoch ${lastDepositEpoch}. Using 1:1 fallback.`);
        }

        const sharesToAdd = (displayPendingDepositAmount * PRECISE_UNIT) / depositSharesPercentage;
        trueConsolidatedShares += sharesToAdd;
        displayPendingDepositAmount = 0;
    }

    if (displayPendingWithdrawalShares > 0 && pendingWithdrawalEpoch < currentEpochId) {
        const [withdrawalEpochPda] = getPerEpochStatePda(pendingWithdrawalEpoch);

        let withdrawalSharesPercentage = PRECISE_UNIT;
        try {
            const withdrawalEpochState = await program.account.perEpochState.fetch(withdrawalEpochPda);
            withdrawalSharesPercentage = withdrawalEpochState.sharesPercentage.toNumber();
        } catch (e) {
            console.warn(`RPC Delay on Withdrawal Epoch ${pendingWithdrawalEpoch}. Using 1:1 fallback.`);
        }

        const usdcToClaim = (displayPendingWithdrawalShares * withdrawalSharesPercentage) / PRECISE_UNIT;
        trueClaimableUsdc += usdcToClaim;
        displayPendingWithdrawalShares = 0;
    }

    return {
        consolidatedShares: trueConsolidatedShares,
        claimableUsdc: trueClaimableUsdc,
        pendingWithdrawalShares: displayPendingWithdrawalShares,
        pendingWithdrawalEpoch: pendingWithdrawalEpoch,
        lastDepositAmount: displayPendingDepositAmount,
        lastDepositEpoch: lastDepositEpoch,
        rawPendingDepositAmount: rawPendingDepositAmount,
        rawLastDepositEpoch: rawLastDepositEpoch,
    };
};