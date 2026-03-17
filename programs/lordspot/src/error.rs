use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
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
}