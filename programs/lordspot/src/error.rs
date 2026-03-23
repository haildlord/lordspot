use anchor_lang::prelude::*;

#[error_code]
pub enum LordspotError {
    // You likely already need this one for your CloseState instruction
    #[msg("Unauthorized access. Admin only.")]
    Unauthorized,

    // --- Randomness Errors ---
    #[msg("Randomness slot mismatch. The request has expired.")]
    RandomnessExpired,

    #[msg("Randomness has already been revealed.")]
    RandomnessAlreadyRevealed,

    #[msg("Randomness seed mismatch.")]
    RandomnessMismatch,

    #[msg("Randomness is not yet resolved by Switchboard.")]
    RandomnessNotResolved,

    #[msg("Invalid EPOCH ID.")]
    InvalidEpochId,

    #[msg("Invalid LP Pool Cap.")]
    InvalidLPPoolCap,

    #[msg("Airthematic Overflow Issue.")]
    AirthMaticOverflow,

    #[msg("Invalid Mint Address.")]
    InvalidMintAddress,

    #[msg("Slot mismatch")]
    SlotMismatch,

    #[msg("Already Revealed Randomness")]
    AlreadyRevealedRandomValue,

    #[msg("Slot Mismatach")]
    SlotMisMatch,

    #[msg("Seed Mismatach")]
    SeedMisMatch,

    #[msg("Unresolved Randomness")]
    UnresolvedRandomness,

    #[msg("Invalid Owner")]
    InvalidOwner,

    #[msg("Invalid Mint")]
    InvalidMint,

    #[msg("Amount cannot be zero")]
    AmountCannotBeZero,
}