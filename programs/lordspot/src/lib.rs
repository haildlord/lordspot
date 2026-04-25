use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod utility;



pub use instructions::*;

declare_id!("EWR8si6rA7qL56eqdGVTDwwfo7uXWfL82SisWeiovsu7");


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


    pub fn lp_deposit(ctx : Context<LpDeposit>, amount_to_deposit : u64) -> Result<()> {
        lp_deposit_handler(ctx, amount_to_deposit)?;
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
}


