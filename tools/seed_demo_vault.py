#!/usr/bin/env python3
"""Fill a vault with a believable demo: a small product team, three weeks of work.

    python3 tools/seed_demo_vault.py                 # the vault in config.json (must be empty, or pass --force)
    python3 tools/seed_demo_vault.py --target /tmp/demo --force
    python3 tools/seed_demo_vault.py --prompts-only   # just the sample prompts, added to whatever is there

Everything is dated relative to today, so the Today board, the week agenda and the work log always look current.
It writes through the same Store the app uses (ids, folders, validation), then backdates created/updated/closed times.
--force EMPTIES the target first: the old files are moved aside to the app's backups/ (`<target>.backup-<timestamp>`).
"""
import argparse
import json
import os
import shutil
import sys
from datetime import date, datetime, timedelta

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_DIR)
from tm.store import Store  # noqa: E402

T = date.today()


def day(n):
    """The day n days from today (negative: in the past), as YYYY-MM-DD."""
    return (T + timedelta(days=n)).isoformat()


def week(n=0):
    y, w, _ = (T + timedelta(days=7 * n)).isocalendar()
    return f'{y}-W{w:02d}'


def stamp(n, hhmm='10:00'):
    return f'{day(n)}T{hhmm}'


def default_target():
    cfg = os.path.join(APP_DIR, 'config.json')
    if os.path.exists(cfg):
        with open(cfg, encoding='utf-8') as f:
            root = json.load(f).get('root') or 'sample-vault'
    else:
        root = 'sample-vault'
    return os.path.realpath(os.path.join(APP_DIR, os.path.expanduser(root)))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--target', default=None, help='vault folder (default: the root in config.json)')
    ap.add_argument('--force', action='store_true', help='move an existing vault aside and fill a fresh one')
    ap.add_argument('--prompts-only', action='store_true', help='only add the sample prompts the vault does not have yet; touch nothing else')
    args = ap.parse_args()
    target = os.path.realpath(os.path.expanduser(args.target)) if args.target else default_target()

    if args.prompts_only:
        cfg_folders = {}
        cfg_path = os.path.join(APP_DIR, 'config.json')
        if os.path.exists(cfg_path) and target == default_target():
            with open(cfg_path, encoding='utf-8') as f:
                cfg_folders = json.load(f).get('folders') or {}
        print(f'added {add_prompts(Store(target, cfg_folders))} prompts to {target}')
        return

    if os.path.isdir(target) and os.listdir(target):
        if not args.force:
            sys.exit(f'{target} is not empty. Use --force to move it aside to a backup and start fresh.')
        os.makedirs(os.path.join(APP_DIR, 'backups'), exist_ok=True)
        backup = os.path.join(APP_DIR, 'backups', f'{os.path.basename(os.path.normpath(target))}.backup-{datetime.now():%Y%m%d-%H%M%S}')
        shutil.move(target, backup)
        print(f'old vault moved to {backup}')
    os.makedirs(target, exist_ok=True)

    cfg_folders = {}
    cfg_path = os.path.join(APP_DIR, 'config.json')
    if os.path.exists(cfg_path) and target == default_target():
        with open(cfg_path, encoding='utf-8') as f:
            cfg_folders = json.load(f).get('folders') or {}
    s = Store(target, cfg_folders)
    build(s)
    print(f'demo vault ready: {target}')


def build(s):
    made = {}

    def mk(key, kind, subject, values=None, body='', created=None, updated=None, closed=None):
        """Create an item and give it a believable history (created / last edit / closing day, in days from today)."""
        it = s.create(kind, subject, values or {}, body)
        made[key] = it['id']
        back = {}
        if created is not None:
            back['created_at'] = stamp(created, '09:15')
        if updated is not None or created is not None:
            back['updated_at'] = stamp(updated if updated is not None else created, '16:40')
        if closed is not None:
            back['completed_at'] = stamp(closed, '17:05')
        if back:
            s._patch_fields(it, back)
        return it

    def comment(key, entries):
        it = s.find(made[key])
        s._patch_fields(it, {'comments': [{'at': stamp(n, hhmm), 'text': text} for n, hhmm, text in entries]})

    # ── people and labels (the suggestions the app offers) ───────────────────────────────────────────
    for name in ('Ana García', 'Marcos Ruiz', 'Lucía Fernández', 'Diego Torres', 'Sofía Marín', 'Carlos Vega', 'Elena Prieto'):
        s.add_person(name)
    for label in ('backend', 'frontend', 'bug', 'seo', 'q4', 'ux', 'infra', 'docs', 'customer', 'research', 'payments', 'email'):
        s.add_label(label)

    # ── initiatives ──────────────────────────────────────────────────────────────────────────────────
    mk('checkout', 'initiative', 'Checkout redesign', {
        'status': 'InProgress', 'priority': 'High', 'plan_week': week(), 'labels': ['ux', 'q4', 'payments'],
        'redmine_id': '4521', 'redmine_url': 'https://redmine.acme-shop.com/issues/4521', 'local_path': '~/work/storefront',
        'url': 'https://www.notion.so/acme/Checkout-redesign-8f2c', 'url_label': 'Notion',
        'links': [{'label': 'Figma', 'url': 'https://www.figma.com/file/Zk3p9/Checkout-v3'},
                  {'label': 'G. Sheet', 'url': 'https://docs.google.com/spreadsheets/d/1aBcD/edit'}]},
        '## Goal\n\nCut checkout abandonment from **68% to under 55%** before the Black Friday campaign.\n\n'
        '## Context\n\nThe funnel report shows 31% of shoppers drop at the payment step, mostly on mobile. '
        'Support also gets weekly tickets about "my card was charged but I saw an error".\n\n'
        '## Success metrics\n\n- Abandonment at payment step < 20%\n- Mobile conversion +1.5 pp\n- Payment-related tickets -40%\n\n'
        '## Out of scope\n\n- Subscriptions and invoicing (handled in the billing initiative)\n', created=-24, updated=0)
    mk('payments', 'initiative', 'Payment methods expansion', {
        'status': 'ToDo', 'priority': 'Normal', 'related_to': made['checkout'], 'labels': ['payments', 'backend']},
        'Add Apple Pay, Google Pay and Bizum to the new checkout once the redesign ships.\n\n'
        '- [x] Compare provider fees\n- [ ] Pick the provider with finance\n- [ ] Sandbox accounts for each method\n', created=-12, updated=-3)
    mk('analytics', 'initiative', 'Analytics dashboard v2', {
        'status': 'Review', 'priority': 'High', 'plan_week': week(), 'labels': ['frontend', 'q4'],
        'redmine_id': '4388', 'redmine_url': 'https://redmine.acme-shop.com/issues/4388',
        'url': 'https://www.figma.com/file/Qx81/Analytics-v2', 'url_label': 'Other'},
        '## Goal\n\nReplace the spreadsheet reports with a self-serve dashboard for the commercial team.\n\n'
        '## Status\n\nCharts and filters are built; waiting for the team to review the revenue-by-channel numbers against finance.\n',
        created=-31, updated=-1)
    mk('onboarding', 'initiative', 'Customer onboarding emails', {
        'status': 'ToDo', 'priority': 'Normal', 'plan_week': week(1), 'labels': ['email', 'customer']},
        'A 4-email sequence for new accounts: welcome, first order tips, reviews request and win-back after 30 days.\n', created=-9, updated=-2)
    mk('seo', 'initiative', 'SEO migration to the new URL structure', {
        'status': 'Blocked', 'priority': 'High', 'labels': ['seo', 'infra'], 'redmine_id': '4410',
        'redmine_url': 'https://redmine.acme-shop.com/issues/4410'},
        '## Why\n\nThe new URL structure (`/c/<category>/<slug>`) must go live with 301 redirects for every old URL, or we lose organic traffic.\n\n'
        '## Blocked\n\nDevOps has to enable the redirect map at the CDN. Waiting for their window (see the meeting with DevOps).\n', created=-20, updated=-4)
    mk('mobile', 'initiative', 'Mobile app beta', {'status': 'OnHold', 'priority': 'Low', 'labels': ['frontend']},
       'Paused until the checkout redesign is done: the app reuses the same payment flow.\n', created=-45, updated=-14)
    mk('billing', 'initiative', 'Q3 billing cleanup', {'status': 'Done', 'priority': 'Normal', 'labels': ['payments', 'q4']},
       'Fix duplicated invoices and reconcile Q3 with finance. Closed after the September audit.\n', created=-60, updated=-6, closed=-6)
    mk('cms', 'initiative', 'Legacy CMS retirement', {'status': 'Discarded', 'priority': 'Low', 'labels': ['infra']},
       'Discarded: the vendor extended support for two more years at the same price.\n', created=-70, updated=-30, closed=-30)
    mk('help', 'initiative', 'Help center revamp', {'status': 'Backlog', 'priority': 'Low', 'labels': ['docs', 'customer']},
       'Reorganise articles by customer journey. Not scheduled yet.\n', created=-18, updated=-18)

    # ── user stories ─────────────────────────────────────────────────────────────────────────────────
    mk('us_applepay', 'story', 'As a shopper I can pay with Apple Pay', {
        'status': 'InProgress', 'priority': 'High', 'related_to': made['checkout'], 'labels': ['payments', 'frontend'],
        'redmine_id': '4522', 'redmine_url': 'https://redmine.acme-shop.com/issues/4522', 'plan_week': week()},
        '**Acceptance**\n\n- Apple Pay button on the payment step (Safari / iOS only)\n- Fallback to card form elsewhere\n- Order confirmation email unchanged\n',
        created=-22, updated=0)
    mk('us_delivery', 'story', 'As a shopper I see delivery estimates before paying', {
        'status': 'ToDo', 'priority': 'Normal', 'related_to': made['checkout'], 'labels': ['ux'], 'plan_week': week(1)},
        'Show the estimated delivery date on the cart and on the payment step, based on postcode and stock.\n', created=-15, updated=-5)
    mk('us_address', 'story', 'As a returning customer I can reuse my saved addresses', {
        'status': 'Review', 'priority': 'Normal', 'related_to': made['checkout'], 'labels': ['frontend']},
        'Address book with a default shipping and billing address.\n', created=-20, updated=-1)
    mk('us_failreason', 'story', 'As a support agent I can see why a payment failed', {
        'status': 'Backlog', 'priority': 'Normal', 'related_to': made['checkout'], 'labels': ['backend', 'customer']},
        'Surface the provider decline code in the admin order page.\n', created=-8, updated=-8)
    mk('us_channel', 'story', 'As a manager I can filter revenue by channel', {
        'status': 'Review', 'priority': 'High', 'related_to': made['analytics'], 'labels': ['frontend'], 'plan_day': day(1), 'plan_week': week()},
        created=-16, updated=-1)
    mk('us_export', 'story', 'As an analyst I can export any chart to CSV', {
        'status': 'InProgress', 'priority': 'Normal', 'related_to': made['analytics'], 'labels': ['frontend', 'backend']},
        created=-14, updated=-2)
    mk('us_welcome', 'story', 'As a new user I get a welcome email within five minutes', {
        'status': 'ToDo', 'priority': 'Normal', 'related_to': made['onboarding'], 'labels': ['email']}, created=-9, updated=-9)
    mk('us_redirect', 'story', 'As a visitor an old URL redirects to its new page', {
        'status': 'Blocked', 'priority': 'High', 'related_to': made['seo'], 'labels': ['seo']}, created=-19, updated=-4)
    mk('us_schedule', 'story', 'As a store owner I can schedule a product launch', {
        'status': 'Backlog', 'priority': 'Low', 'labels': ['ux']},
        'Stands on its own: not tied to an initiative yet.\n', created=-11, updated=-11)

    # ── tasks ────────────────────────────────────────────────────────────────────────────────────────
    # (Today, carried-over, tomorrow, this week, next week, closed: every part of the planning views has something to show.)
    mk('t_merchant', 'task', 'Register the Apple Pay merchant ID', {
        'status': 'Done', 'priority': 'High', 'related_to': made['us_applepay'], 'labels': ['payments'], 'session_name': 'checkout-applepay'},
        '- [x] Create the merchant ID in the Apple developer account\n- [x] Upload the payment-processing certificate\n- [x] Verify the domain file\n',
        created=-12, updated=-7, closed=-7)
    mk('t_button', 'task', 'Implement the Apple Pay button on the payment step', {
        'status': 'InProgress', 'priority': 'High', 'related_to': made['us_applepay'], 'labels': ['frontend', 'payments'],
        'plan_day': day(0), 'plan_week': week(), 'due': day(2), 'session_name': 'checkout-applepay', 'today_list': 'morning'},
        '- [x] Detect support with `ApplePaySession.canMakePayments()`\n- [x] Render the button with the brand style\n'
        '- [ ] Handle the `onpaymentauthorized` callback\n- [ ] Fall back to the card form when cancelled\n',
        created=-8, updated=0)
    mk('t_sandbox', 'task', 'Fix the payment sandbox returning 502 on staging', {
        'status': 'Review', 'priority': 'Urgent', 'related_to': made['us_applepay'], 'labels': ['bug', 'payments', 'infra'],
        'plan_day': day(0), 'plan_week': week(), 'today_list': 'afternoon', 'session_name': 'staging-502'},
        'The provider sandbox started answering 502 after we rotated the API key. Root cause: the key was set for the wrong environment.\n',
        created=-3, updated=0)
    mk('t_delivery_api', 'task', 'Spike: delivery date API from the carrier', {
        'status': 'ToDo', 'priority': 'Normal', 'related_to': made['us_delivery'], 'labels': ['research', 'backend'],
        'plan_day': day(1), 'plan_week': week()}, created=-6, updated=-6)
    mk('t_address_tests', 'task', 'Write end-to-end tests for the address book', {
        'status': 'InProgress', 'priority': 'Normal', 'related_to': made['us_address'], 'labels': ['frontend'],
        'plan_day': day(-2), 'plan_week': week(), 'due': day(-1)},  # carried over: planned two days ago and still open
        created=-9, updated=-2)
    mk('t_copy', 'task', 'Review the checkout microcopy with Sofía', {
        'status': 'ToDo', 'priority': 'Low', 'related_to': made['checkout'], 'labels': ['ux', 'docs'], 'plan_week': week()}, created=-7, updated=-7)
    mk('t_a11y', 'task', 'Accessibility audit of the new payment form', {
        'status': 'ToDo', 'priority': 'High', 'related_to': made['checkout'], 'labels': ['ux', 'frontend'], 'plan_week': week(1), 'due': day(9)},
        'Check keyboard order, labels, error announcements and contrast with the 4.5:1 rule.\n', created=-5, updated=-5)
    mk('t_filter', 'task', 'Fix the channel filter resetting on date change', {
        'status': 'Review', 'priority': 'High', 'related_to': made['us_channel'], 'labels': ['bug', 'frontend'],
        'plan_day': day(0), 'plan_week': week(), 'today_list': 'morning'}, created=-4, updated=0)
    mk('t_numbers', 'task', 'Reconcile dashboard revenue with the finance report', {
        'status': 'InProgress', 'priority': 'Urgent', 'related_to': made['analytics'], 'labels': ['research'],
        'plan_day': day(-1), 'plan_week': week(), 'due': day(1), 'session_name': 'analytics-revenue-check'},  # carried over
        'Finance reports 1.8% less revenue for September. Likely refunds counted on the order day, not the refund day.\n',
        created=-6, updated=-1)
    mk('t_csv', 'task', 'Add CSV export to the revenue table', {
        'status': 'InProgress', 'priority': 'Normal', 'related_to': made['us_export'], 'labels': ['backend'],
        'plan_day': day(2), 'plan_week': week()}, created=-10, updated=-2)
    mk('t_tooltip', 'task', 'Tooltip copy for every KPI card', {
        'status': 'Done', 'priority': 'Low', 'related_to': made['analytics'], 'labels': ['docs'], },
        created=-12, updated=-5, closed=-5)
    mk('t_welcome_copy', 'task', 'Write the welcome email copy', {
        'status': 'ToDo', 'priority': 'Normal', 'related_to': made['us_welcome'], 'labels': ['email'], 'plan_week': week(1), 'due': day(8)},
        created=-9, updated=-9)
    mk('t_template', 'task', 'Build the responsive email template', {
        'status': 'Backlog', 'priority': 'Normal', 'related_to': made['onboarding'], 'labels': ['email', 'frontend']}, created=-9, updated=-9)
    mk('t_redirect_map', 'task', 'Generate the 301 redirect map (4,812 URLs)', {
        'status': 'Done', 'priority': 'High', 'related_to': made['seo'], 'labels': ['seo', 'backend'], 'session_name': 'seo-redirect-map'},
        '- [x] Export old URLs from the sitemap and the server logs\n- [x] Map each to its new slug\n- [x] Validate: no chains, no loops\n',
        created=-17, updated=-8, closed=-8)
    mk('t_cdn', 'task', 'Ask DevOps for a CDN deployment window', {
        'status': 'Blocked', 'priority': 'High', 'related_to': made['seo'], 'labels': ['infra', 'seo'], 'plan_day': day(-3), 'plan_week': week(),
        'due': day(3)}, 'Waiting for Elena to confirm a window. Escalated in the weekly sync.\n', created=-10, updated=-3)
    mk('t_ssl', 'task', 'Renew the SSL certificate for shop.acme-shop.com', {
        'status': 'ToDo', 'priority': 'Urgent', 'labels': ['infra'], 'plan_day': day(0), 'plan_week': week(), 'due': day(6), 'today_list': 'afternoon'},
        'Expires in 6 days. The wildcard is managed by DevOps; ask for the CSR.\n', created=-2, updated=0)
    mk('t_backup', 'task', 'Verify the nightly database backup restores', {
        'status': 'ToDo', 'priority': 'Normal', 'labels': ['infra'], 'plan_day': day(1), 'plan_week': week(), 'due': day(14)},
        created=-3, updated=-3)
    mk('t_licenses', 'task', 'Audit third-party licenses in the storefront', {
        'status': 'Backlog', 'priority': 'Low', 'labels': ['docs']}, created=-13, updated=-13)
    mk('t_providers', 'task', 'Compare Bizum vs Stripe Link fees', {
        'status': 'InProgress', 'priority': 'Normal', 'related_to': made['payments'], 'labels': ['payments', 'research'],
        'plan_day': day(3), 'plan_week': week()}, created=-5, updated=-1)
    mk('t_cleanup', 'task', 'Remove the old coupon code from the cart', {
        'status': 'Done', 'priority': 'Low', 'related_to': made['billing'], 'labels': ['payments'], },
        created=-30, updated=-10, closed=-10)
    mk('t_onepager', 'task', 'Draft the one-pager for the Black Friday campaign', {
        'status': 'InProgress', 'priority': 'High', 'labels': ['q4', 'customer'], 'plan_week': week(), 'due': day(5), 'session_name': 'bf-onepager'},
        created=-4, updated=-1)

    comment('t_sandbox', [
        (-3, '11:20', 'Reproduced with curl: every authorisation call returns 502 since Tuesday.'),
        (-2, '09:45', 'Provider support confirms the sandbox is healthy. It is our key.'),
        (-1, '16:10', 'Found it: the production key was configured on staging. Fixed and redeployed.')])
    comment('t_numbers', [
        (-2, '12:30', 'Finance sent the September export; comparing row by row.'),
        (-1, '10:05', 'The 1.8% gap is 61 refunds booked on the order date instead of the refund date.')])
    comment('t_cdn', [(-3, '17:30', 'Pinged Elena again. She is out until Monday.')])

    # ── notes ────────────────────────────────────────────────────────────────────────────────────────
    mk('n_teardown', 'note', 'Checkout teardown: five competitors', {
        'related_to': made['checkout'], 'labels': ['research', 'ux'], 'url': 'https://www.notion.so/acme/Checkout-teardown-31ab', 'url_label': 'Notion'},
        '## What the best ones do\n\n- **One page, not four**: payment and address on the same screen (3 of 5).\n'
        '- Wallet buttons come *first*, card form second.\n- Delivery date shown before the pay button.\n\n'
        '## What nobody does well\n\nError messages. Most say "payment failed" with no next step.\n', created=-22, updated=-18)
    mk('n_applepay', 'note', 'Apple Pay setup: steps and gotchas', {
        'related_to': made['t_merchant'], 'labels': ['payments', 'docs']},
        '1. Merchant ID in the Apple developer account\n2. Payment-processing certificate (CSR from the provider)\n'
        '3. Host `apple-developer-merchantid-domain-association` at `/.well-known/`\n\n'
        '**Gotcha**: the domain file must be served *without* a redirect, or the verification silently fails.\n', created=-10, updated=-7)
    mk('n_redirects', 'note', 'Redirect rules and edge cases', {
        'related_to': made['seo'], 'labels': ['seo']},
        '- Trailing slashes normalised to none.\n- Query strings kept for `utm_*` only.\n- Discontinued products redirect to their category, not to the home page.\n',
        created=-16, updated=-9)
    mk('n_funnel', 'note', 'Funnel numbers, September', {
        'related_to': made['checkout'], 'labels': ['research', 'customer'], 'url': 'https://docs.google.com/spreadsheets/d/1aBcD/edit', 'url_label': 'G. Sheet'},
        '| Step | Sessions | Drop |\n|---|---|---|\n| Cart | 41,200 | - |\n| Address | 28,300 | 31% |\n| Payment | 19,400 | 31% |\n| Confirmed | 13,100 | 32% |\n',
        created=-21, updated=-21)
    mk('n_refunds', 'note', 'How refunds are booked', {'related_to': made['t_numbers'], 'labels': ['payments', 'docs']},
       'Refund date, not order date, is what finance uses. The dashboard must follow that rule.\n', created=-2, updated=-2)
    mk('n_fridays', 'note', 'Proposal: meeting-free Fridays', {'labels': ['docs']},
       'No meetings on Fridays so engineers get one block of focus time. Try for a month and review in the retro.\n', created=-8, updated=-6)
    mk('n_onboarding', 'note', 'Onboarding email: tone of voice', {'related_to': made['onboarding'], 'labels': ['email', 'docs']},
       'Friendly, short, one call to action per email. Avoid "Dear customer". Sign with a person, not the company.\n', created=-8, updated=-8)
    mk('n_oncall', 'note', 'On-call checklist for payment incidents', {'labels': ['infra', 'payments']},
       '1. Check the provider status page\n2. Look at the error rate on the payments dashboard\n3. Switch to the fallback provider if > 5% for 10 minutes\n4. Post in #incidents\n',
       created=-40, updated=-25)

    # ── meetings and their transcriptions ────────────────────────────────────────────────────────────
    mk('m_kickoff', 'meeting', 'Checkout redesign kick-off', {
        'date': day(-9), 'related_to': made['checkout'], 'attendees': ['Ana García', 'Marcos Ruiz', 'Lucía Fernández', 'Sofía Marín'], 'labels': ['q4']},
        '**Agenda**\n\n1. Why now: abandonment numbers\n2. Scope and out of scope\n3. Timeline to Black Friday\n\n'
        '**Decisions**\n\n- Wallets first, card form second.\n- Launch behind a flag, 10% of traffic first.\n\n**Actions**\n\n- Lucía: prototype by next Friday\n- Marcos: provider shortlist\n',
        created=-10, updated=-9)
    mk('m_sync', 'meeting', 'Weekly product sync', {
        'date': day(-2), 'attendees': ['Ana García', 'Marcos Ruiz', 'Diego Torres', 'Elena Prieto'], 'labels': ['q4']},
        '- Sandbox 502 is on Marcos.\n- SEO migration blocked on a DevOps window.\n- Analytics v2 goes to review on Thursday.\n', created=-3, updated=-2)
    mk('m_devops', 'meeting', 'SEO migration: status with DevOps', {
        'date': day(-4), 'related_to': made['seo'], 'attendees': ['Marcos Ruiz', 'Elena Prieto'], 'labels': ['seo', 'infra']},
        'Redirect map is validated. DevOps needs two weeks notice for a CDN change and a rollback plan.\n', created=-5, updated=-4)
    mk('m_demo', 'meeting', 'Analytics v2 demo for the commercial team', {
        'date': day(1), 'related_to': made['analytics'], 'attendees': ['Ana García', 'Carlos Vega', 'Sofía Marín'], 'labels': ['q4']},
        'Show: revenue by channel, cohort retention, export. Ask: which three reports they open every Monday.\n', created=-2, updated=-2)
    mk('m_one', 'meeting', '1:1 Ana and Marcos', {'date': day(0), 'attendees': ['Ana García', 'Marcos Ruiz']},
       'Career plan, the on-call rota, and the payments tech debt.\n', created=-1, updated=0)

    mk('tr_kickoff', 'transcription', 'Checkout kick-off: transcript', {'related_to': made['m_kickoff'], 'labels': ['q4']},
       '**Ana**: Thanks everyone. Quick context: 68% of people who start checkout leave, and the payment step is where we lose the most.\n\n'
       '**Lucía**: From the teardown, the winners put wallet buttons above the card form. I can prototype that this week.\n\n'
       '**Marcos**: On the backend side, Apple Pay and Google Pay both work through the provider we already use, so no new integration for the first release.\n\n'
       '**Sofía**: I would like to review the error messages. Today they just say "payment failed".\n\n'
       '**Ana**: Agreed. Decision: wallets first, card form second, and we launch behind a flag with ten percent of traffic.\n',
       created=-9, updated=-9)
    mk('tr_sync', 'transcription', 'Weekly product sync: transcript', {'related_to': made['m_sync']},
       '**Ana**: Let us start with blockers. Marcos, the sandbox?\n\n**Marcos**: Still returning 502. I am checking the API keys now.\n\n'
       '**Elena**: For the redirects I need two weeks notice and a rollback plan, otherwise I cannot schedule the CDN change.\n\n'
       '**Diego**: QA can retest the address book on Friday if the build is ready.\n', created=-2, updated=-2)
    mk('tr_devops', 'transcription', 'DevOps call: transcript', {'related_to': made['m_devops'], 'labels': ['seo']},
       '**Elena**: The CDN supports a redirect map up to 10,000 entries, so 4,812 is fine.\n\n'
       '**Marcos**: The map has no chains and no loops, I validated it twice.\n\n**Elena**: Then I need the rollback plan in writing. Send it and I will propose a window.\n',
       created=-4, updated=-4)

    # ── activities: messages that came in ────────────────────────────────────────────────────────────
    mk('a_invoice', 'activity', 'Invoice discrepancy in September', {
        'source': 'Email', 'from': ['Carlos Vega'], 'related_to': made['billing'], 'labels': ['payments']},
        'Hi team, the September invoice from the payment provider is 612 EUR higher than our report. Can someone check if the refunds are counted twice?\n\nThanks,\nCarlos',
        created=-1, updated=-1)
    mk('a_sandbox', 'activity', 'Slack: payment sandbox failing on staging', {
        'source': 'Slack', 'from': ['Diego Torres'], 'related_to': made['t_sandbox'], 'labels': ['bug'],
        'resolution': 'Wrong API key on staging. Fixed and redeployed; QA confirmed the sandbox works again.'},
        'Diego: staging cannot authorise any test payment since yesterday, everything returns 502. Blocking QA for the address book.',
        created=-3, updated=-1)
    mk('a_newsletter', 'activity', 'Newsletter copy for the Black Friday launch', {
        'source': 'Email', 'from': ['Sofía Marín'], 'related_to': made['t_onepager'], 'labels': ['q4', 'email']},
        'Can you review the subject lines before Thursday? I have three options and want to A/B test them.\n\n1. "Black Friday starts now"\n2. "Your cart, 20% lighter"\n3. "Early access, just for you"',
        created=0, updated=0)
    mk('a_export', 'activity', 'Comment: CSV file naming', {
        'source': 'Comment', 'from': ['Ana García'], 'related_to': made['us_export'], 'labels': ['frontend']},
        'Exported files should be named `<chart>-<from>_<to>.csv`, not `export (3).csv`.', created=-2, updated=-2)
    mk('a_cert', 'activity', 'Email from DevOps: certificate renewal window', {
        'source': 'Email', 'from': ['Elena Prieto'], 'related_to': made['t_ssl'], 'labels': ['infra'],
        'resolution': 'Window agreed for Saturday 07:00; CSR sent to DevOps.'},
        'The wildcard certificate renewal needs a CSR from you by Friday. Saturday morning works for the swap.', created=-1, updated=0)
    mk('a_other', 'activity', 'Customer feedback: coupon field is confusing', {
        'source': 'Other', 'from': ['Sofía Marín'], 'related_to': made['checkout'], 'labels': ['customer', 'ux']},
        'Three interviews this week mention the coupon field. They think it is mandatory and leave to look for a code.', created=-5, updated=-5)

    # ── inbox: raw captures ──────────────────────────────────────────────────────────────────────────
    mk('i1', 'inbox', 'Look into Stripe Link as a payment option', {'url': 'https://stripe.com/en-es/payments/link', 'url_label': 'Other'}, created=0, updated=0)
    mk('i2', 'inbox', 'Ask Lucía for the new icon set before Friday', created=-1, updated=-1)
    mk('i3', 'inbox', 'Renew the analytics.acme-shop.com domain', created=-2, updated=-2)
    mk('i4', 'inbox', 'Idea: dark mode for the dashboard', {'labels': ['frontend']}, created=-3, updated=-3)

    add_prompts(s)

    # ── work log: three weeks of it ──────────────────────────────────────────────────────────────────
    kinds = s_kinds()
    log = [
        (-14, 't_merchant', 'Definition', '02:00', 'Merchant ID and certificate walkthrough'),
        (-13, 't_merchant', 'Analysis', '01:30', 'Read the Apple Pay on the Web docs'),
        (-13, 'm_kickoff', 'Meeting', '01:00', 'Kick-off'),
        (-12, 't_redirect_map', 'Analysis', '03:00', 'Export of old URLs from logs'),
        (-11, 't_redirect_map', 'Definition', '02:30', 'Mapping rules'),
        (-10, 't_redirect_map', 'Testing', '01:45', 'Chain and loop validation'),
        (-10, 'a_export', 'Management', '00:20', 'Triage'),
        (-9, 't_merchant', 'Testing', '01:00', 'Domain verification'),
        (-8, 't_redirect_map', 'Testing', '01:15', 'Second validation pass'),
        (-7, 't_tooltip', 'Definition', '01:30', 'Copy for the KPI cards'),
        (-7, 't_merchant', 'Management', '00:30', 'Closing notes'),
        (-6, 't_button', 'Analysis', '02:15', 'Session API and the brand guidelines'),
        (-6, 't_csv', 'Analysis', '01:00', 'Streaming vs in-memory export'),
        (-5, 't_button', 'Definition', '03:00', 'Button component and states'),
        (-5, 'm_devops', 'Meeting', '00:45', 'Call with DevOps'),
        (-4, 't_button', 'Testing', '01:30', 'Safari and iOS checks'),
        (-4, 't_address_tests', 'Testing', '02:00', 'First flows'),
        (-3, 't_sandbox', 'Analysis', '01:30', 'Reproducing the 502'),
        (-3, 't_csv', 'Definition', '02:00', 'CSV endpoint'),
        (-2, 't_sandbox', 'Analysis', '02:00', 'Provider support thread'),
        (-2, 'm_sync', 'Meeting', '00:50', 'Weekly sync'),
        (-2, 't_address_tests', 'Testing', '01:45', 'Edge cases for the default address'),
        (-1, 't_sandbox', 'Testing', '01:00', 'Fix verified on staging'),
        (-1, 't_numbers', 'Analysis', '02:30', 'Row by row against the finance export'),
        (-1, 't_filter', 'Testing', '00:45', 'Reproduced the reset'),
        (0, 't_button', 'Definition', '01:30', 'Authorisation callback'),
        (0, 'm_one', 'Meeting', '00:30', '1:1'),
    ]
    for n, key, kind, t, note in log:
        s.log_work(made[key], kind if kind in kinds else kinds[0], note, day(n), kinds, t)

    # ── pins and the Today board ─────────────────────────────────────────────────────────────────────
    s.save_pins([made['checkout'], made['t_sandbox']])
    s.save_today_lists([{'id': 'uncategorized', 'name': 'Uncategorized'}, {'id': 'morning', 'name': 'Morning'},
                        {'id': 'afternoon', 'name': 'Afternoon'}, {'id': 'waiting', 'name': 'Waiting'}])
    print(f"created {len(made)} items, {len(log)} work-log entries")


# Reusable prompts, grouped by what they act on (the label says which): meetings, tasks, initiatives and stories, and the rest.
# They are written to be loaded as the "Extra instruction" of "Work on it with Claude": the item itself is already in the prompt.
PROMPTS = [
    # meetings (and their transcriptions)
    ('Meeting: summary, decisions and actions', ['meetings'], -30,
     'Summarise this meeting in under 200 words: first the decisions (bullets), then the actions (owner, due date), then the open questions. '
     'Keep the speakers\' names. If something is ambiguous, list it as an open question instead of guessing.'),
    ('Meeting: follow-up email to the attendees', ['meetings', 'email'], -28,
     'Write the follow-up email for this meeting: a two-line recap, the decisions, and a list of actions with owner and date. '
     'Friendly and short. Subject line included. Do not send anything.'),
    ('Meeting: actions as a checklist of tasks', ['meetings', 'tasks'], -26,
     'Extract every action item from this meeting as a Markdown checklist `- [ ] <owner>: <action> (due <date>)`. '
     'Only what was explicitly agreed; mark with "?" anything that needs confirmation.'),
    ('Meeting: prepare the agenda', ['meetings'], -24,
     'Prepare an agenda for this meeting: goal in one sentence, 3 to 5 topics with a time box each, who leads each one, and the decision we need at the end. '
     'Use what the item and its related initiative say; ask me for anything missing before inventing it.'),
    ('Transcript: clean up and fix names', ['meetings'], -22,
     'Clean this transcript: remove filler words and false starts, fix obvious speech-to-text mistakes (names, product terms), '
     'keep the speaker labels and the meaning. Do not summarise and do not add content.'),
    # tasks
    ('Task: plan the work before touching anything', ['tasks'], -30,
     'Read this task and the files it mentions. Do not change anything yet. Give me: the steps in order, what could go wrong, '
     'what you need to know before starting, and how we will know it is done. Wait for my go-ahead.'),
    ('Task: implement it test-first', ['tasks'], -28,
     'Implement this task test-first: write the failing test, make it pass with the smallest change, then refactor. '
     'Run the whole test suite at the end and tell me what changed, file by file.'),
    ('Task: find the risks and unknowns', ['tasks'], -26,
     'List the unknowns and risks of this task, ranked by how likely they are to blow the plan. For each, say how to find out cheaply (a spike, a question, a log) '
     'and who to ask.'),
    ('Task: review it before closing', ['tasks'], -24,
     'Before I close this task, check it against its description and checklist: what is done, what is missing, what was left untested. '
     'Answer with a short list of "ready to close" or "not yet, because…".'),
    ('Task: PR description', ['tasks'], -22,
     'Write the pull request description for the work on this task: what and why in two sentences, how to test it, screenshots to attach, '
     'and anything the reviewer should look at first.'),
    ('Task: triage a bug report', ['tasks'], -20,
     'Read the item and the files it mentions. Reproduce the bug if you can, then tell me the most likely root cause (with evidence), the smallest fix '
     'and how to prove it is fixed. Do not change anything until I approve.'),
    ('Task: code review, correctness first', ['tasks'], -18,
     'Review the changes for this task as a senior engineer. Focus, in this order: correctness bugs and edge cases, security, missing or brittle tests. '
     'Ignore style unless it hides a bug. For each finding give file and line, the failing scenario and a suggested fix.'),
    # initiatives and stories
    ('Story: split it into tasks', ['stories'], -30,
     'Split this user story into tasks that one person can finish in a day or less. For each: a verb-first title, a one-line description and the order they depend on. '
     'Mark which ones can run in parallel.'),
    ('Story: acceptance criteria (Given/When/Then)', ['stories'], -28,
     'Write the acceptance criteria for this user story in Given/When/Then form: the happy path, the main error cases and the edge cases. '
     'Keep each scenario to three lines.'),
    ('Initiative: status update for stakeholders', ['initiatives'], -26,
     'Write a status update for this initiative for people who are not on the team: where we are in one sentence, what moved since last week, '
     'what is at risk, and what we need from them. Under 150 words, no jargon.'),
    ('Initiative: pre-mortem', ['initiatives'], -24,
     'Imagine this initiative failed three months from now. List the five most plausible reasons, how early we would see each one, '
     'and one thing we can do this week to reduce it.'),
    # notes, activities, inbox and the rest
    ('Note: rewrite it clearly', ['notes'], -30,
     'Rewrite this note so someone who was not there can use it: clear headings, short paragraphs, the same facts. '
     'Do not add information; mark with [?] anything that looks incomplete.'),
    ('Activity: draft a reply', ['activities', 'email'], -28,
     'Draft a reply to this message: answer what was asked, state anything we need from them and by when, and keep it polite and short. '
     'Match the language of the message. Do not send it.'),
    ('Activity: options to resolve it', ['activities'], -26,
     'Give me two or three ways to resolve this activity with the pros and cons of each, recommend one, and write the resolution text I would save on it.'),
    ('Inbox: turn the capture into a task', ['inbox', 'tasks'], -24,
     'Turn this raw capture into a well-formed task: a verb-first title, a two-line description, a suggested priority, and which initiative or story it probably belongs to. '
     'Ask me if the intent is unclear.'),
    # general
    ('General: explain it simply', ['general'], -30,
     'Explain what this item is about in plain language, as if to a new team member: the context, why it matters and what a good outcome looks like.'),
    ('General: release notes from the commits', ['general'], -28,
     'Summarise the commits since the last tag as release notes for customers: group by New, Improved and Fixed, one line each, plain language, no ticket numbers.'),
    ('General: explain and speed up a SQL query', ['general'], -26,
     'Explain what this query does in two sentences, point out what makes it slow (missing index, N+1, large sort) and propose a faster version '
     'with the index it needs. Say what the EXPLAIN should look like afterwards.'),
]


def add_prompts(s):
    """Create the sample prompts that the vault does not have yet (matched by subject), and the labels they use."""
    have = {it['title'] for it in s.items() if it['type'] == 'prompt'}
    added = 0
    for subject, labels, ago, text in PROMPTS:
        if subject in have:
            continue
        it = s.create('prompt', subject, {'labels': labels}, text)
        s._patch_fields(it, {'created_at': stamp(ago, '09:30'), 'updated_at': stamp(ago, '09:30')})
        added += 1
    return added


def s_kinds():
    from tm.store import DEFAULT_WORK_KINDS
    return list(DEFAULT_WORK_KINDS)


if __name__ == '__main__':
    main()
