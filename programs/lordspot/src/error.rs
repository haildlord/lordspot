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

    #[msg("Invalid Marble Config")]
    InvalidMarbleConfig,

    #[msg("Drawing time has not passed yet.")]
    DrawingNotReady,

    #[msg("Tally is already settled.")]
    TallyAlreadySettled,

    #[msg("Tally is not yet settled.")]
    TallyNotSettled,

    #[msg("Ticket order mismatch. Pass tickets in sequential order.")]
    InvalidTicketOrder,

    #[msg("Drawing is not yet completed.")]
    DrawingNotCompleted,

    #[msg("Ticket has already been claimed.")]
    AlreadyClaimed,

    #[msg("Invalid LP soft cap calculation")]
    InvalidLPSoftCap,

    #[msg("current epoch's drawing state's is locked")]
    LordspotLocked,

    #[msg("Invalid previous epoch ID")]
    InvalidPreviousEpochId,

    #[msg("LordsPot is not Locket yet")]
    LordspotNotLocked,

    #[msg("LordsPot is already Locket")]
    LordspotAlreadyLocked,

    #[msg("Need to wait more, its not time yet to run LordsPot")]
    CameTooEarlyToRunLordsPot,

    #[msg("Parsing of Randomness Account failed.")]
    RandomnessParseFailed,

    #[msg("To many draws.")]
    TooManyDraws,

    #[msg("Internal Math Error")]
    InternalMathError,

    #[msg("While buying marbles are not sorted.")]
    UnsortedMarbles,

    #[msg("User has reached the maximum ticket limit (50) for this epoch")]
    UserEpochLimitReached,

    #[msg("The global protocol has reached its maximum ticket capacity (1200) for this epoch")]
    GlobalEpochLimitReached,

}