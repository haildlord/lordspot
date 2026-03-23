use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod utility;



pub use instructions::*;

declare_id!("7eBJpDhqrtdEyBnrHwNb6QEbJ4YQxz9k2KacKH6oe9W6");


#[program]
pub mod lords_pot {
    use super::*;

    // pub fn initialize(ctx: Context<Initialize>, rngkp: Pubkey) -> Result<()> {
    //     handler(ctx, rngkp)?;
    //     Ok(())
    // }
    //
    // pub fn close_state(ctx : Context<CloseState>) -> Result<()> {
    //     close_handler(ctx)?;
    //     Ok(())
    // }
    //
    // pub fn commit_to_random_num(ctx : Context<CommitToRandomNum>) -> Result<()>{
    //     commit_to_random_num_handler(ctx)?;
    //     Ok(())
    // }
    //
    // pub fn save_random_num(ctx: Context<SaveRandomNum>) -> Result<()> {
    //     save_random_num_handler(ctx)?;
    //     Ok(())
    // }
}


