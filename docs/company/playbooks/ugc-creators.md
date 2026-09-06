# Playbook: creators on commission (the Submagic route)

Source: Alex Olim's breakdown of how David Zitoun took Submagic to $1M
ARR in 90 days. The quotable line is "if I make you rich, you will make
me rich"; the execution is what matters, and it maps cleanly onto a
company of agents with a human board.

## The sequence, as they ran it

1. **Prove the format yourself.** A brand-new TikTok account, zero
   followers, one screen-recording video a day. No creators yet.
2. **Wait for the signal.** Ten days of nothing, then one video at 100K
   views brought 40–50 paying customers. That is the proof: the format
   converts, not just entertains.
3. **Recruit at volume.** About 1,000 creators messaged in a week; 50–70
   signed, aged 18–25, most with zero-follower accounts.
4. **Simple, generous structure.** 30% lifetime commission, one video a
   day, no paid ads allowed. He was buying reps, not creativity.
5. **Compound.** 3,500 creators by month six, 9,000+ by mid-2025, about a
   fifth of revenue from creator content.

## Prodigal AI version

Product: *Launch your AI company*. The screen recording writes itself:
a founder types a mission, the board watches the org graph light up, an
agent parks a LinkedIn post for approval, the founder taps Approve from
Telegram. Thirty seconds, no voice-over needed.

| Phase | Who does it | Gate |
|---|---|---|
| **Format testing (weeks 1–2)** | Format tester agent scripts and storyboards one clip a day from real product runs; Nishchal records and posts from a fresh account (posting is a human action until the platform integration lands) | `content.publish` parks each script for the board |
| **Validation** | Analyst tracks views, signups by UTM/referral code, paying conversions per clip; recruitment stays blocked until one clip clears the threshold in `company.yaml` (default: 50K views and 20 paying) | mission acceptance |
| **Recruitment (week 3+)** | Recruiter agent finds creators (18–25, zero-follower fine, India + global English), drafts the pitch, sends 150/day through the email integration; first contact parks, replies are free | `email.send` first-contact gate |
| **Onboarding** | Creator ops agent registers each signed creator with a referral code, sends the kit (format, do/don't, the 30% terms, the no-ads rule), checks the first three videos | `creators.add` is a write; the kit email is a reply |
| **Compounding** | Analyst posts a weekly leaderboard; ops nudges creators who miss a day; finance pays commissions monthly from the ERP cash account | payouts are board-paid expenses |

## The offer

- 30% lifetime commission on every subscription attributed to the
  creator's code (tracked in the creator program; paid monthly).
- One video a day, screen-recorded, in the proven format. The kit gives
  the exact beats; creativity is welcome after the first ten.
- No paid ads on creator content, ever. Organic reach is the deal.
- Zero-follower accounts are fine. Reps are what we buy.

## Numbers to watch (the analyst's weekly report)

Clips posted, views, click-through to the referral link, signups,
paying, revenue attributed, commission owed, creators active (posted in
the last 3 days), creators churned, cost per paying customer. The
mission is over when creator content drives 20% of new revenue.

## What the agents never do

- Post to a personal social account without the board's approval (every
  publish parks).
- Promise commission terms other than the ones in `company.yaml`.
- Message a creator who said no, or anyone under 18.
- Run ads.

## In the product

- Template: `templates/companies/ugc-growth.yaml` (growth lead, format
  tester, recruiter, creator ops, analyst).
- Creator program: `creators.*` tools and the Creators screen (roster,
  codes, attributed revenue, commissions owed, payouts through ERP).
- Statement: commissions appear as `creator-commission` expenses so the
  CA sees them with everything else.
