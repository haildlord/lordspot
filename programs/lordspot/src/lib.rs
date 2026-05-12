use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod utility;
pub mod event;



pub use instructions::*;

declare_id!("2cm7EMzH5ne9N8A8fDn6e2ZHtpBxwaFrYNGkpQcn8DAi");


#[program]
pub mod lords_pot {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        rngkp: Pubkey,
        normal_marble_max: u8,
        pool_total_cap: u64,
        ticket_price: u64,
        lp_target_percent: u64,
        special_ball_min: u8,
        special_ball_soft_cap: u8,
        special_ball_hard_cap: u8,
        protocol_fee: u64,
        protocol_fee_threshold: u64,
        drawing_duration: u64
    ) -> Result<()> {

        init_handler(
            ctx,
            rngkp,
            normal_marble_max,
            pool_total_cap,
            ticket_price,
            lp_target_percent,
            special_ball_min,
            special_ball_soft_cap,
            special_ball_hard_cap,
            protocol_fee,
            protocol_fee_threshold,
            drawing_duration
        )?;

        Ok(())
    }

    pub fn init_lordspot(ctx:Context<InitializeLordsPot>, now_time : u64) -> Result<()> {
        init_lordspot_handler(ctx, now_time)?;
        Ok(())
    }

    pub fn buy_tickets(ctx: Context<BuyTicket>, amount_to_buy : Vec<TicketInput>) -> Result<()> {
        buy_ticket_handler(ctx, amount_to_buy)?;
        Ok(())
    }

    pub fn commit(ctx: Context<CommitToRandomNum>) -> Result<()> {
        commit_to_random_num_handler(ctx)?;
        Ok(())
    }

    pub fn save(ctx: Context<SaveRandomNum>, use_known_winning_ticket : bool) -> Result<()> {
        save_random_num_handler(ctx, use_known_winning_ticket)?;
        Ok(())
    }

    pub fn run_lordspot(ctx: Context<RunLordspot>) -> Result<()> {
        run_lordspot_handler(ctx)?;
        Ok(())
    }

    pub fn claim_rewards(ctx: Context<ClaimRewards>, _epoch_id: u64, packed_ticket_to_claim: u64) -> Result<()> {
        claim_rewards_handler(ctx,_epoch_id,packed_ticket_to_claim)?;
        Ok(())
    }

    pub fn lp_deposit(ctx : Context<LpDeposit>, amount_to_deposit : u64) -> Result<()> {
        lp_deposit_handler(ctx, amount_to_deposit)?;
        Ok(())
    }

    pub fn lp_initiate_withdraw(ctx : Context<InitiateWithdraw>,  amount_in_shares: u64) -> Result<()> {
        initiate_withdraw_handler(ctx, amount_in_shares)?;
        Ok(())
    }

    pub fn lp_finalize_withdraw(ctx : Context<FinalizeWithdraw>) -> Result<()> {
        finalize_withdraw_handler(ctx)?;
        Ok(())
    }




    // ! remove this function when deploying -- so ignore cuzz only for testing purpose
    pub fn universal_close(ctx: Context<UniversalClose>) -> Result<()> {
        let target = &ctx.accounts.target_pda;
        let receiver = &ctx.accounts.receiver;

        // 1. Drain all lamports from the PDA and send them to the receiver
        let lamports = target.lamports();
        **target.lamports.borrow_mut() = 0;
        **receiver.lamports.borrow_mut() = receiver.lamports().checked_add(lamports).unwrap();

        // 2. Wipe the account data completely
        // This ensures if anything tries to read it in the same transaction, it reads zeroes
        let mut target_data = target.data.borrow_mut();
        target_data.fill(0);

        Ok(())
    }

    #[derive(Accounts)]
    pub struct UniversalClose<'info> {
        #[account(mut)]
        pub admin: Signer<'info>,

        /// CHECK: This is our universal testing wipe account.
        /// We only enforce that this program actually owns the account being destroyed.
        #[account(
            mut,
            owner = crate::ID
        )]
        pub target_pda: AccountInfo<'info>,

        /// The account that will receive the reclaimed rent lamports
        #[account(mut)]
        pub receiver: SystemAccount<'info>,
    }

    pub fn change_drawing_duration(ctx : Context<ChangeDrawingTime>, drawing_duration: u64) -> Result<()> {
        change_drawing_time_handler(ctx, drawing_duration)?;
        Ok(())
    }

}


