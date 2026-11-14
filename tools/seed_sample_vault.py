#!/usr/bin/env python3
"""Rebuild the two sample vaults with dates relative to today, so the demo never goes stale.

    python3 tools/seed_sample_vault.py

sample-vault/            the Projects structure, the one a new vault gets: initiatives of each kind (product, agentic
                         system, simple; Acme Web holds both a product and an agentic system one) and every type
sample-vault-legacy/     the legacy Initiatives structure (folder per type), every type it has: what its tests and
                         tools/migrate_structures.py read until that structure is retired

Both carry people and groups (Contacts) with their details, labels, docs, work-log days and a favourite, so every screen has something to
show. tests/test_samples.py checks that each matches its structure and has an item of every type.
"""
import os
import shutil
import sys
from datetime import date, timedelta

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, APP_DIR)
from tm.store import Store  # noqa: E402
from tm.structures.ticketing.definition import ROOT_FOLDERS, WORKLOG_FOLDER  # noqa: E402

FOLDERS_VAULT = os.path.join(APP_DIR, 'sample-vault-legacy')
TICKETING_VAULT = os.path.join(APP_DIR, 'sample-vault')
# What each project's initiatives are (tm/structures/kinds.py): Acme Web also gets an agentic system, last.
KIND_IN = {'ACME': 'product', 'OPS': 'system', 'MOVE': 'simple'}

PEOPLE = {
    'Ana': {'emails': ['ana@example.com'], 'calendar_name': 'Ana García', 'slack': '@ana',
            'when_to_use': 'Product and pricing questions; by Slack.', 'notes': 'Leads the pricing team.'},
    'Pablo': {'emails': ['pablo@example.com'], 'slack': '@pablo'},
    'Marta': {'emails': ['marta@example.com'], 'calendar_name': 'Marta López',
              'when_to_use': 'Anything that needs a budget or a yes from leadership; by email.'},
}
GROUPS = {
    'Product team': {'channel': 'slack', 'address': '#product', 'members': ['Ana', 'Pablo'],
                     'when_to_use': 'When an item is ready for review or done: post its id and what changed.'},
    'Leadership': {'channel': 'email', 'address': 'leadership@example.com', 'members': ['Marta'],
                   'when_to_use': 'When an initiative is done or slips past its due date: a short email with the outcome.'},
}


def week(d):
    y, w, _ = d.isocalendar()
    return f'{y}-W{w:02d}'


def fresh(path):
    shutil.rmtree(path, ignore_errors=True)
    os.makedirs(path)


def people_and_labels(s, labels):
    for name, values in PEOPLE.items():
        s.add_person(name, values)
    for name, values in GROUPS.items():
        s.add_group(name, values)
    for label in labels:
        s.add_label(label)


def seed_folders(path=FOLDERS_VAULT):
    """The folder-per-type sample: one folder per type, ids PREFIX-0001."""
    fresh(path)
    s = Store(path)
    t = date.today()
    y = t - timedelta(days=1)
    people_and_labels(s, ['pricing', 'growth', 'ops'])
    s.create('initiative', 'Pricing revamp', {
        'status': 'InProgress', 'priority': 'High', 'plan_week': week(t), 'sidebar': True, 'labels': ['pricing'],
        'ticket_id': '4521', 'ticket_url': 'https://redmine.example.com/issues/4521', 'local_path': '~/Documents',
        'url': 'https://www.notion.so/pricing-revamp',
        'links': [{'label': 'Figma', 'url': 'https://www.figma.com/file/pricing'}]},
        '## Goal\n\nSimplify pricing to three plans.\n\n## Context\n\nChurn is concentrated in the legacy plans.\n')
    s.create('story', 'As a buyer I see three plans side by side', {
        'related_to': 'INI-0001', 'status': 'InProgress', 'ticket_id': '4522', 'ticket_url': 'https://redmine.example.com/issues/4522'})
    s.create('story', 'As an admin I can change plan prices', {'related_to': 'INI-0001', 'status': 'Backlog'})
    s.create('initiative', 'Onboarding emails', {'status': 'Backlog', 'priority': 'Normal', 'sidebar': True, 'labels': ['growth']})
    s.create('task', 'Benchmark competitor pricing', {
        'related_to': 'INI-0001', 'status': 'InProgress', 'priority': 'High', 'labels': ['pricing'],
        'plan_day': t.isoformat(), 'plan_week': week(t), 'due': (t + timedelta(days=2)).isoformat()},
        '- [x] List 5 competitors\n- [x] Capture their plans\n- [ ] Compare per-seat prices\n- [ ] Summary for the team\n')
    s.create('task', 'Draft pricing tiers', {'related_to': 'INI-0001', 'status': 'ToDo', 'plan_week': week(t), 'labels': ['pricing']})
    s.create('task', 'Renew SSL certificate', {'priority': 'Urgent', 'labels': ['ops']})
    s.create('task', 'Review analytics dashboard', {'status': 'Review', 'plan_day': y.isoformat(), 'plan_week': week(y)})
    s.create('task', 'Set up pricing A/B test', {'related_to': 'INI-0001', 'status': 'Blocked'})
    s.create('task', 'Write welcome email copy', {'related_to': 'INI-0002', 'priority': 'Low', 'labels': ['growth']})
    s.create('task', 'Collect churn data', {'related_to': 'INI-0001', 'status': 'Done'})
    s.create('note', 'Pricing ideas', {'related_to': 'INI-0001', 'labels': ['pricing']}, '- Annual discount 20%\n- Free tier limited to 1 seat\n')
    s.create('meeting', 'Pricing kick-off', {'related_to': 'INI-0001', 'date': y.isoformat(), 'time': '10:00', 'duration': '00:45',
                                             'attendees': ['Ana', 'Pablo']},
             '## Agenda\n\n- Scope\n- Owners\n\n## Notes\n\n- Ana owns the benchmark.\n')
    s.create('transcription', 'Pricing kick-off — transcript', {'related_to': 'MTG-0001'},
             '**Ana:** Let us keep three plans and drop the legacy ones.\n\n**Pablo:** Then the A/B test needs the new page first.\n')
    s.create('activity', 'Re: pricing page copy', {
        'source': 'Email', 'from': 'Ana', 'related_to': 'INI-0001', 'date': y.isoformat(),
        'url': 'https://mail.example.com/thread/18c2', 'session_name': 'pricing-copy'},
        'Hi, could you confirm the three plan names before Friday? Marketing needs them for the landing.\n')
    s.create('activity', 'Slack: SSL warning on staging', {'source': 'Slack', 'from': 'Pablo', 'related_to': 'TSK-0003',
                                                          'resolution': 'Renewal scheduled, TSK-0003 tracks it.'},
             'Getting a cert warning on staging since this morning, is that known?\n')
    s.create('inbox', 'Look into tax settings for EU customers', {'url': 'https://docs.example.com/tax'})
    s.create('prompt', 'Weekly review', {'labels': ['ops']},
             'Go through what I closed this week and what is still open. List the three things most worth doing next '
             'week, and anything that has been waiting longer than two weeks.\n')
    s.create('agent', 'Support triage agent', {'status': 'Design', 'priority': 'Normal'},
             'Reads new support emails, guesses their area and drafts a first answer for a human to send.\n')
    s.make_folder('docs/Handbook', parents=True)
    s.create_file('docs/Handbook/Pricing principles.md',
                  '# Pricing principles\n\n- Three plans, no more.\n- Prices end in 0.\n- Annual saves two months.\n')
    s.log_work('TSK-0001', 'Analysis', 'competitor list', y.isoformat(), time='00:45')
    s.log_work('INI-0001', 'Meeting', 'kick-off', y.isoformat(), time='00:45')
    s.log_work('TSK-0006', 'Testing', '', y.isoformat(), time='00:30')
    s.log_work('TSK-0001', 'Analysis', 'captured plans', t.isoformat(), time='01:30')
    s.log_work('TSK-0002', 'Definition', '', t.isoformat(), time='01:00')
    return path


def seed_ticketing(path=TICKETING_VAULT):
    """The Ticketing sample: projects as folders, short ids (`STY-5`), every type of the structure."""
    fresh(path)
    for folder in (*ROOT_FOLDERS.values(), WORKLOG_FOLDER):
        os.makedirs(os.path.join(path, folder), exist_ok=True)
    s = Store(path, structure='ticketing', enforce_structure=True)
    t = date.today()
    y = t - timedelta(days=1)
    people_and_labels(s, ['checkout', 'billing', 'infra'])
    s.create('project', 'Acme Web', {'project_key': 'ACME'},
             'The customer-facing shop: catalogue, cart and checkout.\n')
    s.create('project', 'Internal Tools', {'project_key': 'OPS'},
             'The scripts and dashboards the team runs on.\n')
    s.create('project', 'Office Move', {'project_key': 'MOVE'},
             'Moving the team to the new office: nothing to deliver, just initiatives and their tasks.\n')
    ini = s.create('initiative', 'Checkout redesign', {'project': 'ACME', 'initiative_kind': 'product', 'sidebar': True, 'labels': ['checkout']},
                   '## Goal\n\nA one-page checkout that keeps more carts.\n')['id']
    sup = s.create('support', 'Invoice email arrives empty', {'project': 'ACME', 'level': 'C2', 'origin': 'customer', 'labels': ['billing']},
                   'Two customers report an empty invoice email since the last release.\n')['id']
    # Its support tickets come with its first delivering initiative (tm/structures/kinds.py).
    ops = s.create('initiative', 'Faster deploys', {'project': 'OPS', 'initiative_kind': 'system', 'labels': ['infra'], 'sidebar': False})['id']
    s.create('support', 'Nightly backup took 3 hours', {'project': 'OPS', 'level': 'C1', 'labels': ['infra']})
    s.create('story', 'Address, shipping and payment on one page', {'project': 'ACME', 'related_to': ini, 'size': 'M', 'labels': ['checkout']},
             '## Story\n\nAs a shopper, I want to pay on one page, so that I do not give up halfway.\n\n'
             '## Acceptance criteria\n\n#### Scenario: Paying in one go\n- **WHEN** the cart goes to checkout\n'
             '- **THEN** address, shipping and payment are on the same page\n')
    s.create('story', 'Keep the cart when the payment fails', {'project': 'ACME', 'related_to': ini, 'size': 'S', 'labels': ['checkout']})
    spec = s.create('spec', 'Checkout', {'project': 'ACME', 'capability': 'checkout', 'labels': ['checkout']},
                    '## Purpose\n\nTake a cart to a paid order.\n\n## Requirements\n\n'
                    '### Requirement: Cart is kept\nThe system SHALL keep the cart until the order is paid.\n\n'
                    '#### Scenario: Leaving checkout\n- **WHEN** the shopper leaves checkout before paying\n'
                    '- **THEN** the cart is there when they come back\n')['id']
    s.update(spec, {'status': 'active'})
    s.create('story', 'Cache the test dependencies', {'project': 'OPS', 'related_to': ops, 'size': 'S', 'labels': ['infra']})
    s.create('task', 'Map the current checkout steps', {'project': 'ACME', 'related_to': ini, 'labels': ['checkout'],
                                                        'plan_day': t.isoformat(), 'plan_week': week(t)})
    s.create('task', 'Draft the empty-invoice reply', {'project': 'ACME', 'related_to': sup, 'plan_week': week(t)})
    s.create('task', 'Clean up old feature flags', {})
    move = s.create('initiative', 'Set up the new office', {'project': 'MOVE', 'initiative_kind': 'simple', 'labels': ['infra']})['id']
    s.create('task', 'Order the desks', {'project': 'MOVE', 'related_to': move, 'plan_week': week(t)})
    s.create('hotfix', 'Restore the invoice template', {'project': 'ACME', 'related_to': sup, 'labels': ['billing']})
    s.create('prd', 'One-page checkout', {'project': 'ACME', 'related_to': ini},
             '## Problem\n\nFour steps lose a third of the carts.\n\n## Scope\n\nAddress, shipping and payment on one page.\n')
    s.create('plan', 'Roll out the one-page checkout', {'project': 'ACME', 'related_to': ini}, '1. Map the steps\n2. Prototype\n3. A/B test\n')
    s.create('analysis', 'Why carts are abandoned', {'project': 'ACME', 'related_to': ini})
    s.create('error', 'Coupon applied twice', {'project': 'ACME', 'related_to': sup})
    s.create('learning', 'Flags before big UI changes', {'project': 'ACME', 'related_to': ini})
    mtg = s.create('meeting', 'Checkout review', {'project': 'ACME', 'related_to': ini, 'date': y.isoformat(), 'time': '11:00',
                                                  'attendees': ['Ana', 'Marta']}, '- Agreed on one page.\n')['id']
    s.create('transcription', 'Checkout review transcript', {'project': 'ACME', 'related_to': mtg, 'labels': ['checkout']},
             'Ana: Four steps is too many.\nMarta: Then one page, and we measure the carts kept.\n')
    s.create('note', 'Payment providers', {'project': 'ACME', 'labels': ['checkout']}, '- Stripe\n- Adyen\n')
    s.create('agent', 'Support triage agent', {}, 'Reads new support tickets and suggests their level.\n')
    s.create('activity', 'Re: empty invoice', {'source': 'Email', 'from': 'Ana', 'related_to': sup, 'date': y.isoformat()},
             'Same here: the invoice email has no attachment and no total.\n')
    s.create('inbox', 'Try passkeys for login', {})
    s.create('prompt', 'Support reply', {'labels': ['billing']},
             'Draft a reply to this support ticket: say what we found, what we did, and when the customer will see it fixed.\n')
    s.make_folder('Docs/Team', parents=True)
    s.make_folder('Acme Web/Docs/Architecture', parents=True)
    s.create_file('Docs/Team/How we ship.md', HOW_WE_SHIP)
    s.create_file('Acme Web/Docs/Architecture/Overview.md', ARCHITECTURE)
    first_task = next(i['id'] for i in s.items() if i['type'] == 'task')
    s.log_work(first_task, 'Analysis', 'steps mapped', y.isoformat(), time='01:15')
    s.log_work(ini, 'Meeting', 'review', y.isoformat(), time='00:30')
    s.log_work(first_task, 'Definition', '', t.isoformat(), time='02:00')
    seed_showcase(s, t)
    return path


HOW_WE_SHIP = """# How we ship

Small changes, shipped often, each one easy to undo.

## The path of a change

1. A story is **ready** when its scenarios are written and its initiative is approved.
2. One branch and one pull request per story; an agent may write it, a person reviews it.
3. CI runs the suites in parallel; a red check blocks the merge.
4. Merged to `main` means deployed: behind a flag until the story is done.

## Before a release

- [ ] Release notes drafted (`/release-notes`) and read by Product
- [ ] Smoke test on staging (`/qa:smoke-test`)
- [ ] Rollback plan written for anything touching payments

| When | Who | What |
|---|---|---|
| Daily 9:00 | everyone | stand-up, async in #product |
| Wednesday | Product team | backlog review |
| Friday | Marta | weekly review and the update to Leadership |
"""

ARCHITECTURE = """# Overview

Acme Web is a server-rendered shop in front of three services.

| Service | Owns | Talks to |
|---|---|---|
| Catalogue API | products, prices, stock | search index |
| Cart service | carts, coupons | Payments API |
| Payments API | charges, refunds | Stripe |

## Decisions in force

- **Carts live in the cart service**, never in the session: a failed payment keeps the cart (SPEC-7).
- **Every payment call carries an idempotency key** since the double-charge incident (LRN after SUP-2).
- **Search is a separate index**, rebuilt nightly and patched on every product change.
"""

CHECKOUT_REDESIGN = """## Goal

A one-page checkout that keeps more carts: address, shipping and payment on one page, with the delivery date and the
total visible before paying.

## Objective

Drop-off at checkout under 40% (it is 61% today), measured over two weeks on all traffic.

## Premise

Most carts are lost between the shipping and the payment step, not at the payment itself. Verified on the analytics
funnel of the last 30 days: 38% of carts leave at step 3 of 4.

## Boundaries

- **Always:** the cart is kept on a failed payment; every payment call carries an idempotency key.
- **Never:** ask for an account before paying.
- **Out of scope:** wallets (Apple Pay and Google Pay have their own initiative).

## Stories

Delivered in order: guest checkout, the one page, autocomplete, the delivery date, the cart kept on a failed payment.
"""


TEAM = {  # the Projects sample's team beyond PEOPLE: the names its boards, meetings and watchers show
    'Leo': {'emails': ['leo@example.com'], 'calendar_name': 'Leo Martín', 'slack': '@leo',
            'when_to_use': 'Payments and the checkout code; by Slack.', 'notes': 'Tech lead of the checkout squad.'},
    'Sofia': {'emails': ['sofia@example.com'], 'calendar_name': 'Sofia Rossi', 'slack': '@sofia',
              'when_to_use': 'Design reviews and copy; tag her on the Figma file.'},
    'Kenji': {'emails': ['kenji@example.com'], 'slack': '@kenji', 'when_to_use': 'Support escalations and customer replies.'},
}


def seed_showcase(s, t):
    """What makes the Projects sample look like a team's real week: goals and the work that moves them, items spread over
    every status, priority and size, a plan for today and this week, meetings, agents, prompts and a few days of logged
    time. Only appended after the first items, so their ids (STY-5, INI-1…) stay as tests and docs name them. Every move
    goes through the rules a person's would (ticketing/rules.py): one step at a time, an initiative ready only with its
    premise verified and a story with its scenario, and an initiative following its stories."""
    day = lambda n: (t + timedelta(days=n)).isoformat()  # noqa: E731
    for name, values in TEAM.items():
        s.add_person(name, values)
    for label in ('payments', 'search', 'support', 'ai', 'release'):
        s.add_label(label)
    flow = ('Backlog', 'ToDo', 'InProgress', 'Review', 'Done')
    ref = lambda r: s.find(r)['id']  # noqa: E731

    def move(item_id, status=None, body=None, **values):
        if values or body is not None:
            s.update(item_id, values, body=body)
        now = s.find(item_id)['fields'].get('status') or 'Backlog'
        if status and status != now:
            steps = flow[flow.index(now) + 1:flow.index(status) + 1] if now in flow and status in flow else (status,)
            for step in steps:
                s.update(item_id, {'status': step}, by='owner')  # a person moving it, as the page does

    def new(item_type, title, body='', status=None, **values):
        if item_type == 'initiative':
            values.setdefault('initiative_kind', KIND_IN.get(values.get('project'), 'simple'))
        item_id = s.create(item_type, title, values, body)['id']
        move(item_id, status)
        return item_id

    def ready(ini, what):  # Backlog → ToDo: what was measured before committing to it
        move(ini, 'ToDo', regime='standard', premise='verified', premise_verified=f'{day(-3)} @ 4f2a9c1; {what}')

    def story(title, ini, scenario, as_a='a shopper', **values):
        when, then = scenario
        body = (f'## Story\n\nAs {as_a}, I want to {title[0].lower() + title[1:]}.\n\n## Acceptance criteria\n\n'
                f'#### Scenario: {title}\n- **WHEN** {when}\n- **THEN** {then}\n')
        values.setdefault('spec_impact', 'none: a new screen, no requirement changes')
        status = values.pop('status', None)
        item_id = new('story', title, body, related_to=ini, **values)
        return item_id, status

    def start(stories):  # once their initiative is ready
        for item_id, status in stories:
            move(item_id, status)

    # Goals: what the work is for, across projects (GOL-27, GOL-28).
    checkout = new('goal', 'Launch the new checkout', status='InProgress', priority='P1', labels=['checkout'],
                   priority_reason='Checkout drop-off is the largest leak in the funnel', start=day(-7), due=day(36),
                   plan_week=week(t), description='Customers pay on one page, and fewer of them leave at checkout.\n'
                   'Met when the new checkout is live for everyone and drop-off is under 40%.')
    deploys = new('goal', 'Ship in minutes, not hours', priority='P2', due=day(83),
                  description='A change reaches production in minutes: deploys under 10 minutes and no manual steps.')
    ini, ops_ini, sup_invoice, sup_backup = ref('INI-1'), ref('INI-3'), ref('SUP-2'), ref('SUP-4')
    for item, goal, order in (('INI-1', checkout, 1), ('STY-5', checkout, 2), ('TSK-9', checkout, 3), ('STY-6', checkout, 4),
                              ('OPS', deploys, 1), ('INI-3', deploys, 2), ('TSK-11', deploys, 3)):
        move(ref(item), goal=goal, goal_order=order)
    support = new('goal', 'Answer every customer within a day', status='InProgress', priority='P1', labels=['support'],
                  start=day(-14), due=day(50), plan_week=week(t),
                  description='Every new ticket gets a first answer in under 24 hours, and C1 tickets in under one.')

    # Acme Web — Checkout redesign (INI-1): its first stories, and three more.
    later = [story(*args, project='ACME', labels=['checkout'], goal=checkout, **values) for args, values in (
        (('Show the delivery date before paying', ini, ('the shopper picks a shipping method', 'the delivery date shows next to its price')),
         dict(status='Review', priority='P2', size='S')),
        (('Check out as a guest', ini, ('a shopper with no account checks out', 'they pay with an email address and nothing else')),
         dict(status='Done', priority='P1', size='M')),
        (('Autocomplete the address as I type', ini, ('the shopper types three letters of a street', 'up to five addresses are suggested')),
         dict(status='InProgress', priority='P2', size='S', executor='claude', branch='feat/address-autocomplete')))]
    move(ref('STY-6'), priority='P1', spec_impact='checkout: the cart is kept on a failed payment',
         body='## Story\n\nAs a shopper, I want my cart kept when the payment fails, so that I can try another card.\n\n'
              '## Acceptance criteria\n\n#### Scenario: A card is declined\n- **WHEN** the payment is declined\n'
              '- **THEN** the shopper is back on checkout with the same cart\n')
    move(ref('STY-5'), priority='P1', spec_impact='checkout: one page instead of four steps')
    move(ini, priority='P1', size='L', due=day(36), body=CHECKOUT_REDESIGN)
    for key, status, priority, begin, end in (('ACME', 'InProgress', 'P1', -60, 120), ('OPS', 'InProgress', 'P2', -30, 90),
                                              ('MOVE', 'ToDo', 'P3', 7, 60)):
        s.update(key, {'status': status, 'priority': priority, 'start': day(begin), 'due': day(end)}, by='owner')
    ready(ini, 'drop-off at checkout is 61% across four steps (analytics, last 30 days)')
    start([(ref('STY-5'), 'InProgress'), (ref('STY-6'), 'ToDo'), *later])
    move(ref('STY-5'), executor='claude', branch='feat/one-page-checkout')

    # Acme Web — wallets and search.
    wallets = new('initiative', 'Apple Pay and Google Pay', '## Goal\n\nPay in two taps on a phone.\n', project='ACME', priority='P1',
                  size='M', labels=['payments', 'checkout'], goal=checkout, goal_order=5, due=day(30))
    pay = [story(*args, project='ACME', labels=['payments'], **values) for args, values in (
        (('Pay with Apple Pay on iPhone', wallets, ('a shopper on Safari for iPhone reaches payment', 'Apple Pay is the first option')),
         dict(status='ToDo', priority='P1', size='M')),
        (('Pay with Google Pay on Android', wallets, ('a shopper on Chrome for Android reaches payment', 'Google Pay is the first option')),
         dict(priority='P2', size='M')))]
    ready(wallets, '38% of checkouts start on a phone; wallets convert 1.6x (provider benchmark)')
    start(pay)
    search = new('initiative', 'Search that finds what people type', '## Goal\n\nFewer searches with no results.\n',
                 project='ACME', priority='P2', size='L', labels=['search'], due=day(21))
    found = [story(*args, project='ACME', labels=['search'], **values) for args, values in (
        (('Find products despite a typo', search, ('a shopper searches for "snekers"', 'sneakers are the first results')),
         dict(status='InProgress', priority='P1', size='L', executor='claude', branch='feat/typo-search')),
        (('Filter by size, colour and price', search, ('a shopper picks size 42 and black', 'only those products are listed, with their count')),
         dict(status='Review', priority='P2', size='M')),
        (('See suggestions as I type', search, ('a shopper types "run"', 'running shoes and running shorts are suggested')),
         dict(status='Done', priority='P2', size='S')))]
    ready(search, '14% of searches return nothing, half of them typos (search logs, last 30 days)')
    start(found)
    new('analysis', 'Searches with no results', '## Finding\n\n14% of searches return nothing; half of them are typos.\n',
        project='ACME', related_to=search)

    # Acme Web — support, a hotfix and its post-mortem.
    charged = new('support', 'Customer charged twice after a timeout', 'The payment page timed out and the retry charged again.\n',
                  project='ACME', level='C1', origin='user', status='InProgress', priority='P0', labels=['payments'])
    new('support', 'Discount code rejected at checkout', project='ACME', level='C3', origin='user', status='ToDo', priority='P3', labels=['checkout'])
    new('support', 'No shipping cost for the Canary Islands', project='ACME', level='C2', origin='user', status='Done', priority='P2')
    move(sup_invoice, 'InProgress', priority='P1')
    move(sup_backup, 'ToDo', priority='P2')
    rollback = 'Revert the release tag; the previous template is kept for 30 days.'
    move(ref('HFX-14'), 'Review', priority='P0', rollback_plan=rollback)
    move(ref('HFX-14'), 'Done', postmortem=ref('ERR-18'))
    new('hotfix', 'Make the payment retry idempotent', project='ACME', related_to=charged, priority='P0', labels=['payments'],
        rollback_plan='Turn off the retry_idempotency flag.', status='Review')

    # Tasks: today's plan, this week's and what waits.
    for title, values, body in (
            ('Plan the split test of the one-page checkout', dict(related_to=ini, status='InProgress', priority='P1', plan_day=day(0), due=day(3),
                                                                       labels=['checkout'], goal=checkout, goal_order=6),
             '- [x] Pick the metric: carts kept\n- [x] Size the sample\n- [ ] Split by device\n- [ ] Review with Ana\n'),
            ('Review the checkout copy with Sofia', dict(related_to=ini, status='ToDo', priority='P2', plan_day=day(0), labels=['checkout'],
                                                         watchers=['Sofia']), ''),
            ('Check the payment retry fix on staging', dict(related_to=charged, status='Review', priority='P0', plan_day=day(0), due=day(0),
                                                            labels=['payments']),
             '- [x] Reproduce the timeout\n- [x] Retry twice\n- [ ] One charge in the Stripe dashboard\n'),
            ('Reply to the double-charge customers', dict(related_to=charged, status='InProgress', priority='P0', plan_day=day(0),
                                                          labels=['support'], goal=support, goal_order=3), ''),
            ('Load-test the payments API', dict(related_to=wallets, status='ToDo', priority='P1', plan_day=day(1), labels=['payments']), ''),
            ('Prototype the one-page layout in Figma', dict(related_to=ini, status='Done', priority='P1', labels=['checkout'],
                                                            goal=checkout, goal_order=7), ''),
            ('Measure the drop-off at each step', dict(related_to=ini, status='Done', priority='P1', labels=['checkout']), ''),
            ('Prepare the release notes for 2.4', dict(status='ToDo', priority='P2', plan_week=week(t), due=day(4), labels=['release']),
             '- [ ] Merged pull requests since 2.3\n- [ ] Screenshots of the new checkout\n- [ ] Send to the Product team\n')):
        new('task', title, body, project='ACME', **values)
    move(ref('TSK-9'), 'InProgress', priority='P1', due=day(2))
    move(ref('TSK-10'), 'Review', priority='P1', plan_day=day(0))
    move(ref('TSK-11'), priority='P3')

    # Internal Tools — faster deploys (INI-3) and the support agents.
    deploy_stories = [story(*args, project='OPS', labels=['infra'], goal=deploys, as_a='an engineer', **values) for args, values in (
        (('Run the test suites in parallel', ops_ini, ('a pull request is opened', 'the suites run on four workers and finish in under 5 minutes')),
         dict(status='InProgress', priority='P1', size='M')),
        (('Roll back in one click', ops_ini, ('a release breaks production', 'one click puts the previous one back in under a minute')),
         dict(status='ToDo', priority='P2', size='M')),
        (('Get a preview for every pull request', ops_ini, ('a pull request is opened', 'its preview URL is posted on it')),
         dict(priority='P3', size='L')))]
    move(ref('STY-8'), priority='P2', spec_impact='none: CI only', body='## Story\n\nAs an engineer, I want the test dependencies '
         'cached, so that CI starts in seconds.\n\n## Acceptance criteria\n\n#### Scenario: A second run\n- **WHEN** CI runs again '
         'with the same lockfile\n- **THEN** dependencies come from the cache\n')
    move(ops_ini, priority='P2', size='M')
    ready(ops_ini, 'a deploy takes 47 minutes, 31 of them waiting on tests (CI timings, last 20 runs)')
    start([(ref('STY-8'), 'Done'), *deploy_stories])
    triage = new('initiative', 'Support triage with agents',
                 '## Goal\n\nAn agent reads every new ticket, sets its level and drafts the first reply; a person sends it.\n',
                 project='OPS', priority='P1', size='M', labels=['ai', 'support'], goal=support, goal_order=1)
    agents = [story(*args, project='OPS', labels=['ai', 'support'], as_a='a support lead', **values) for args, values in (
        (('Get a first reply drafted for every new ticket', triage, ('a ticket arrives', 'a draft reply and a level are on it within five minutes')),
         dict(status='InProgress', priority='P1', size='M', executor='claude', goal=support, goal_order=2)),
        (('Get a daily digest of open tickets in Slack', triage, ('it is 9:00 on a weekday', 'the open tickets are posted in #support by level')),
         dict(status='ToDo', priority='P2', size='S')))]
    ready(triage, 'first replies take 31 hours on average; 70% are one of six answers (helpdesk export)')
    start(agents)
    new('task', 'Move the nightly backup to incremental', project='OPS', related_to=sup_backup, status='InProgress', priority='P2',
        plan_day=day(1), labels=['infra'])
    new('task', 'Rotate the staging API keys', project='OPS', status='ToDo', priority='P0', plan_day=day(0), due=day(0), labels=['infra'])
    new('task', 'Update the on-call runbook', project='OPS', priority='P3', labels=['infra'])

    # Office Move: an initiative and its tasks.
    move_ini = ref('INI-12')
    move(move_ini, 'InProgress', priority='P2', due=day(45))
    move(ref('TSK-13'), 'Done')
    for title, values in (('Book the movers', dict(status='Done')), ('Survey the Wi-Fi on the new floor', dict(status='InProgress', plan_day=day(2))),
                          ('Order screens for the meeting rooms', dict(status='ToDo', due=day(10)))):
        new('task', title, project='MOVE', related_to=move_ini, **values)

    # This week's meetings, notes and records.
    new('meeting', 'Weekly product sync', '## Agenda\n\n- Checkout A/B plan\n- Wallets scope\n- Support backlog\n',
        project='ACME', related_to=ini, date=day(0), time='09:30', duration='00:30', attendees=['Ana', 'Leo', 'Sofia'])
    new('meeting', 'Search design review', project='ACME', related_to=search, date=day(1), time='15:00', duration='00:45',
        attendees=['Sofia', 'Pablo'])
    new('meeting', 'Support triage retro', project='OPS', related_to=triage, date=day(2), time='12:00', duration='00:30',
        attendees=['Kenji', 'Marta'])
    new('note', 'Checkout metrics to watch', '| Metric | Now | Target |\n|---|---|---|\n| Drop-off at checkout | 61% | < 40% |\n'
        '| Time to pay | 3m 10s | < 1m |\n| Payment errors | 2.1% | < 0.5% |\n', project='ACME', labels=['checkout'], goal=checkout)
    new('learning', 'Retries need an idempotency key', project='ACME', related_to=charged)

    # Agents and prompts: what the team runs with Claude.
    new('agent', 'Release notes writer', 'Reads the merged pull requests since the last tag and drafts the release notes.\n', status='Live')
    new('agent', 'Weekly review', 'Every Friday: what closed, what slipped, and the three things worth doing next week.\n', status='Build')
    new('prompt', 'Release notes from merged PRs', 'List the pull requests merged since the last release, group them as New, Improved and '
        'Fixed, and write one plain sentence each for a customer.\n', labels=['release'])
    new('prompt', 'Explain this error', 'Explain this error to me as if I had not written the code: what failed, the likely cause, and the '
        'smallest fix.\n')
    new('inbox', 'Wishlists shared by link', url='https://www.figma.com/file/wishlists')
    new('activity', 'Slack: payment timeouts spiking', 'Seeing a jump in payment timeouts since 10:00, anyone on it?\n',
        source='Slack', related_to=charged, date=day(0), **{'from': 'Pablo'})

    # Acme Web holds an agentic system too: the agents that answer shoppers, beside the shop itself.
    concierge = new('initiative', 'Shopping assistant agent', '## Goal\n\nAn agent answers questions about products and orders in chat.\n',
                    project='ACME', initiative_kind='system', priority='P2', size='M', labels=['ai'])
    story('Ask where my order is', concierge, ('a shopper asks about an order in chat', 'the agent answers with its status and tracking link'),
          project='ACME', labels=['ai'], priority='P2', size='S')

    # A week of logged time.
    for n, item, kind, note, time in ((-4, 'STY-5', 'Development', 'layout', '02:30'), (-4, 'INI-1', 'Meeting', 'kick-off', '00:45'),
                                      (-3, 'STY-8', 'Development', 'cache keys', '01:45'), (-3, 'SUP-2', 'Analysis', 'template diff', '01:00'),
                                      (-2, 'STY-5', 'Development', 'payment form', '03:00'), (-2, 'TSK-10', 'Definition', 'reply draft', '00:40'),
                                      (-1, 'INI-3', 'Analysis', 'slowest steps', '01:20'), (0, 'TSK-10', 'Testing', '', '00:30')):
        s.log_work(ref(item), kind, note, day(n), time=time)


def keep_empty_folders(path):
    """A .gitkeep in every empty folder: git keeps no empty folder, and a structure may need one (a project's Plans/)."""
    for folder, dirs, files in os.walk(path):
        if not dirs and not files:
            open(os.path.join(folder, '.gitkeep'), 'w').close()
    return path


def main():
    print(f'sample vault rebuilt at {keep_empty_folders(seed_folders())}')
    print(f'sample vault rebuilt at {keep_empty_folders(seed_ticketing())}')


if __name__ == '__main__':
    main()
