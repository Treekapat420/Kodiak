use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_lang::system_program::{self, Transfer};

declare_id!("11111111111111111111111111111111");

const CONFIG_SEED: &[u8] = b"kodiak-rewards";
const VAULT_SEED: &[u8] = b"vault";
const EPOCH_SEED: &[u8] = b"epoch";
const CLAIM_SEED: &[u8] = b"claim";
const LEAF_DOMAIN: &[u8] = b"kodiak-sol-rewards-v1";
const MAX_PROOF_DEPTH: usize = 32;

#[program]
pub mod kodiak_sol_rewards {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.mint = ctx.accounts.mint.key();
        config.vault_bump = ctx.bumps.vault;
        config.config_bump = ctx.bumps.config;
        config.paused = false;
        config.next_epoch_id = 0;
        config.total_funded = 0;
        config.total_claimed = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, lamports: u64) -> Result<()> {
        require!(lamports > 0, RewardsError::ZeroAmount);

        let cpi_accounts = Transfer {
            from: ctx.accounts.depositor.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            cpi_accounts,
        );

        system_program::transfer(cpi_ctx, lamports)?;

        ctx.accounts.config.total_funded = ctx
            .accounts
            .config
            .total_funded
            .checked_add(lamports)
            .ok_or(RewardsError::MathOverflow)?;

        emit!(VaultFunded {
            depositor: ctx.accounts.depositor.key(),
            lamports,
        });

        Ok(())
    }

    pub fn publish_epoch(
        ctx: Context<PublishEpoch>,
        epoch_id: u64,
        merkle_root: [u8; 32],
        total_rewards: u64,
        expires_at: i64,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, RewardsError::Paused);
        require!(total_rewards > 0, RewardsError::ZeroAmount);
        require!(
            epoch_id == ctx.accounts.config.next_epoch_id,
            RewardsError::UnexpectedEpoch
        );

        if expires_at != 0 {
            let now = Clock::get()?.unix_timestamp;
            require!(expires_at > now, RewardsError::InvalidExpiry);
        }

        require!(
            ctx.accounts.vault.lamports() >= total_rewards,
            RewardsError::VaultUnderfunded
        );

        let epoch = &mut ctx.accounts.epoch;
        epoch.config = ctx.accounts.config.key();
        epoch.epoch_id = epoch_id;
        epoch.merkle_root = merkle_root;
        epoch.total_rewards = total_rewards;
        epoch.claimed_rewards = 0;
        epoch.created_at = Clock::get()?.unix_timestamp;
        epoch.expires_at = expires_at;
        epoch.epoch_bump = ctx.bumps.epoch;

        ctx.accounts.config.next_epoch_id = ctx
            .accounts
            .config
            .next_epoch_id
            .checked_add(1)
            .ok_or(RewardsError::MathOverflow)?;

        emit!(EpochPublished {
            epoch_id,
            merkle_root,
            total_rewards,
            expires_at,
        });

        Ok(())
    }

    pub fn claim(
        ctx: Context<Claim>,
        epoch_id: u64,
        amount: u64,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, RewardsError::Paused);
        require!(amount > 0, RewardsError::ZeroAmount);
        require!(proof.len() <= MAX_PROOF_DEPTH, RewardsError::ProofTooDeep);
        require!(
            ctx.accounts.epoch.epoch_id == epoch_id,
            RewardsError::UnexpectedEpoch
        );

        if ctx.accounts.epoch.expires_at != 0 {
            require!(
                Clock::get()?.unix_timestamp <= ctx.accounts.epoch.expires_at,
                RewardsError::EpochExpired
            );
        }

        let leaf = reward_leaf(epoch_id, &ctx.accounts.claimant.key(), amount);
        require!(
            verify_merkle_proof(ctx.accounts.epoch.merkle_root, leaf, &proof),
            RewardsError::InvalidProof
        );

        let next_claimed = ctx
            .accounts
            .epoch
            .claimed_rewards
            .checked_add(amount)
            .ok_or(RewardsError::MathOverflow)?;

        require!(
            next_claimed <= ctx.accounts.epoch.total_rewards,
            RewardsError::EpochOverdraw
        );

        require!(
            ctx.accounts.vault.lamports() >= amount,
            RewardsError::VaultUnderfunded
        );

        let config_key = ctx.accounts.config.key();
        let vault_bump = [ctx.accounts.config.vault_bump];
        let vault_seeds: &[&[u8]] = &[VAULT_SEED, config_key.as_ref(), &vault_bump];

        let signer_seeds = &[vault_seeds];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.claimant.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );

        system_program::transfer(cpi_ctx, amount)?;

        ctx.accounts.epoch.claimed_rewards = next_claimed;
        ctx.accounts.config.total_claimed = ctx
            .accounts
            .config
            .total_claimed
            .checked_add(amount)
            .ok_or(RewardsError::MathOverflow)?;

        let receipt = &mut ctx.accounts.receipt;
        receipt.epoch = ctx.accounts.epoch.key();
        receipt.claimant = ctx.accounts.claimant.key();
        receipt.amount = amount;
        receipt.claimed_at = Clock::get()?.unix_timestamp;
        receipt.receipt_bump = ctx.bumps.receipt;

        emit!(RewardClaimed {
            epoch_id,
            claimant: ctx.accounts.claimant.key(),
            lamports: amount,
        });

        Ok(())
    }

    pub fn set_paused(ctx: Context<AuthorityOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PauseChanged { paused });
        Ok(())
    }

    pub fn rotate_authority(
        ctx: Context<AuthorityOnly>,
        new_authority: Pubkey,
    ) -> Result<()> {
        require!(
            new_authority != Pubkey::default(),
            RewardsError::InvalidAuthority
        );

        let old_authority = ctx.accounts.config.authority;
        ctx.accounts.config.authority = new_authority;

        emit!(AuthorityRotated {
            old_authority,
            new_authority,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Only the mint address is stored. Token parsing stays off-chain.
    pub mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + RewardsConfig::INIT_SPACE,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, RewardsConfig>,

    /// CHECK: Deterministic PDA vault.
    #[account(
        seeds = [VAULT_SEED, config.key().as_ref()],
        bump
    )]
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    /// CHECK: Used only to derive and validate the config PDA.
    pub mint: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.config_bump,
        constraint = config.mint == mint.key() @ RewardsError::WrongMint
    )]
    pub config: Account<'info, RewardsConfig>,

    /// CHECK: Deterministic PDA.
    #[account(
        mut,
        seeds = [VAULT_SEED, config.key().as_ref()],
        bump = config.vault_bump
    )]
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(epoch_id: u64)]
pub struct PublishEpoch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Used only to derive and validate the config PDA.
    pub mint: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.config_bump,
        constraint = config.authority == authority.key() @ RewardsError::Unauthorized,
        constraint = config.mint == mint.key() @ RewardsError::WrongMint
    )]
    pub config: Account<'info, RewardsConfig>,

    /// CHECK: Read-only balance check.
    #[account(
        seeds = [VAULT_SEED, config.key().as_ref()],
        bump = config.vault_bump
    )]
    pub vault: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + RewardEpoch::INIT_SPACE,
        seeds = [EPOCH_SEED, config.key().as_ref(), &epoch_id.to_le_bytes()],
        bump
    )]
    pub epoch: Account<'info, RewardEpoch>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(epoch_id: u64)]
pub struct Claim<'info> {
    #[account(mut)]
    pub claimant: Signer<'info>,

    /// CHECK: Used only to derive and validate the config PDA.
    pub mint: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.config_bump,
        constraint = config.mint == mint.key() @ RewardsError::WrongMint
    )]
    pub config: Account<'info, RewardsConfig>,

    #[account(
        mut,
        seeds = [EPOCH_SEED, config.key().as_ref(), &epoch_id.to_le_bytes()],
        bump = epoch.epoch_bump,
        constraint = epoch.config == config.key() @ RewardsError::WrongConfig
    )]
    pub epoch: Account<'info, RewardEpoch>,

    /// CHECK: Deterministic PDA.
    #[account(
        mut,
        seeds = [VAULT_SEED, config.key().as_ref()],
        bump = config.vault_bump
    )]
    pub vault: UncheckedAccount<'info>,

    #[account(
        init,
        payer = claimant,
        space = 8 + ClaimReceipt::INIT_SPACE,
        seeds = [CLAIM_SEED, epoch.key().as_ref(), claimant.key().as_ref()],
        bump
    )]
    pub receipt: Account<'info, ClaimReceipt>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AuthorityOnly<'info> {
    pub authority: Signer<'info>,

    /// CHECK: Used only to derive and validate the config PDA.
    pub mint: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.config_bump,
        constraint = config.authority == authority.key() @ RewardsError::Unauthorized,
        constraint = config.mint == mint.key() @ RewardsError::WrongMint
    )]
    pub config: Account<'info, RewardsConfig>,
}

#[account]
#[derive(InitSpace)]
pub struct RewardsConfig {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub vault_bump: u8,
    pub config_bump: u8,
    pub paused: bool,
    pub next_epoch_id: u64,
    pub total_funded: u64,
    pub total_claimed: u64,
}

#[account]
#[derive(InitSpace)]
pub struct RewardEpoch {
    pub config: Pubkey,
    pub epoch_id: u64,
    pub merkle_root: [u8; 32],
    pub total_rewards: u64,
    pub claimed_rewards: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub epoch_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ClaimReceipt {
    pub epoch: Pubkey,
    pub claimant: Pubkey,
    pub amount: u64,
    pub claimed_at: i64,
    pub receipt_bump: u8,
}

#[event]
pub struct VaultFunded {
    pub depositor: Pubkey,
    pub lamports: u64,
}

#[event]
pub struct EpochPublished {
    pub epoch_id: u64,
    pub merkle_root: [u8; 32],
    pub total_rewards: u64,
    pub expires_at: i64,
}

#[event]
pub struct RewardClaimed {
    pub epoch_id: u64,
    pub claimant: Pubkey,
    pub lamports: u64,
}

#[event]
pub struct PauseChanged {
    pub paused: bool,
}

#[event]
pub struct AuthorityRotated {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[error_code]
pub enum RewardsError {
    #[msg("The rewards program is paused.")]
    Paused,
    #[msg("The caller is not the rewards authority.")]
    Unauthorized,
    #[msg("The supplied mint does not match this rewards configuration.")]
    WrongMint,
    #[msg("The supplied rewards configuration is incorrect.")]
    WrongConfig,
    #[msg("Amount must be greater than zero.")]
    ZeroAmount,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
    #[msg("The epoch id is not the next expected epoch.")]
    UnexpectedEpoch,
    #[msg("The epoch expiry must be in the future, or zero for no expiry.")]
    InvalidExpiry,
    #[msg("This reward epoch has expired.")]
    EpochExpired,
    #[msg("The Merkle proof is invalid.")]
    InvalidProof,
    #[msg("The Merkle proof is too deep.")]
    ProofTooDeep,
    #[msg("The epoch would pay more than its published reward total.")]
    EpochOverdraw,
    #[msg("The rewards vault does not contain enough SOL.")]
    VaultUnderfunded,
    #[msg("The new authority is invalid.")]
    InvalidAuthority,
}

fn reward_leaf(epoch_id: u64, wallet: &Pubkey, amount: u64) -> [u8; 32] {
    hashv(&[
        LEAF_DOMAIN,
        &epoch_id.to_le_bytes(),
        wallet.as_ref(),
        &amount.to_le_bytes(),
    ])
    .to_bytes()
}

fn verify_merkle_proof(
    root: [u8; 32],
    leaf: [u8; 32],
    proof: &[[u8; 32]],
) -> bool {
    let mut current = leaf;

    for sibling in proof {
        let next = if current <= *sibling {
            hashv(&[&current, sibling]).to_bytes()
        } else {
            hashv(&[sibling, &current]).to_bytes()
        };
        current = next;
    }

    current == root
}

#[cfg(test)]
mod tests {
    use super::*;

    fn combine(a: [u8; 32], b: [u8; 32]) -> [u8; 32] {
        if a <= b {
            hashv(&[&a, &b]).to_bytes()
        } else {
            hashv(&[&b, &a]).to_bytes()
        }
    }

    #[test]
    fn merkle_proof_accepts_valid_leaf() {
        let wallet_a = Pubkey::new_unique();
        let wallet_b = Pubkey::new_unique();
        let a = reward_leaf(7, &wallet_a, 123);
        let b = reward_leaf(7, &wallet_b, 456);
        let root = combine(a, b);

        assert!(verify_merkle_proof(root, a, &[b]));
        assert!(verify_merkle_proof(root, b, &[a]));
    }

    #[test]
    fn merkle_proof_rejects_wrong_amount() {
        let wallet_a = Pubkey::new_unique();
        let wallet_b = Pubkey::new_unique();
        let a = reward_leaf(7, &wallet_a, 123);
        let b = reward_leaf(7, &wallet_b, 456);
        let root = combine(a, b);

        let wrong = reward_leaf(7, &wallet_a, 124);
        assert!(!verify_merkle_proof(root, wrong, &[b]));
    }
}
