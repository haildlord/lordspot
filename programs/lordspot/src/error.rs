use anchor_lang::prelude::*;

#[error_code]
pub enum LordspotError {

    #[msg("Unauthorized access. Admin only.")]
    Unauthorized,

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

    #[msg("Airthematic Underflow Issue.")]
    AirthMaticUnderflow,

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

    #[msg("Lp Pool Cap exceeded")]
    ExceedsPoolCap,

    #[msg("LP deposits not initialized.")]
    LPDepositsNotInitialized,

    #[msg("LordsPot already initialized.")]
    LordspotAlreadyInitialized,

    #[msg("No LP Deposits")]
    NoLPDeposits,

    #[msg("Missing Previous Epoch Account")]
    MissingPreviousEpochAccount,

    #[msg("Invalid Marble Config")]
    InvalidMarbleConfiguration,

    #[msg("Ticket Purchase not allowed.")]
    TicketPurchaseNotAllowed,

    #[msg("Lordspot is locked.")]
    LordspotIsLocked,

    #[msg("Not enough liquidity.")]
    NotEnoughLiquidity,

    #[msg("Invalid ProtocolUSDCVault")]
    InvalidProtocolUSDCVault,

    #[msg("Invalid Normals Count.")]
    InvalidNormalsCount,

    #[msg("Invalid Special Ball.")]
    InvalidSpecialMarble,

    #[msg("Invalid Marble.")]
    InvalidMarble,

    #[msg("Duplicate Marble")]
    DuplicateMarble,

    #[msg("Too many tickets in one transaction. Max is 5.")]
    TooManyTickets,

    #[msg("No tickets provided.")]
    NoTicketsProvided,

    #[msg("Ticket account mismatch. Wrong PDA passed.")]
    TicketAccountMismatch,

    #[msg("Ticket purchase window is closed.")]
    DrawingClosed,
}

// https://code4rena.com/reports/2025-11-megapot
// BaseScan ->
// Jackpot: 0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2
// JackpotLPManager: 0xE63E54DF82d894396B885CE498F828f2454d9dCf
// JackpotTicketNFT: 0x48FfE35AbB9f4780a4f1775C2Ce1c46185b366e4
// JackpotAutoSubscription: 0x02A58B725116BA687D9356Eafe0fA771d58a37ac
// BatchPurchaseFacilitator: 0x01774B531591b286b9f02C6Bc02ab3fD9526Aa76
// JackpotRandomTicketBuyer: 0xb9560b43b91dE2c1DaF5dfbb76b2CFcDaFc13aBd
// GuaranteedMinimumPayoutCalculator: 0x97a22361b6208aC8cd9afaea09D20feC47046CBD
// ScaledEntropyProvider: 0x5D030DEC2e0d38935e662C0d2feD44B050c8Ae51