#!/usr/bin/env python3
"""Rebuild the two sample vaults with dates relative to today, so the demo never goes stale.

    python3 tools/seed_sample_vault.py

sample-vault/            the folder-per-type structure: every type it has (prompts and transcriptions too)
sample-vault-ticketing/  the Ticketing structure: two projects and every type, from support to learnings

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

FOLDERS_VAULT = os.path.join(APP_DIR, 'sample-vault')
TICKETING_VAULT = os.path.join(APP_DIR, 'sample-vault-ticketing')

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
        'redmine_id': '4521', 'redmine_url': 'https://redmine.example.com/issues/4521', 'local_path': '~/Documents',
        'url': 'https://www.notion.so/pricing-revamp',
        'links': [{'label': 'Figma', 'url': 'https://www.figma.com/file/pricing'}]},
        '## Goal\n\nSimplify pricing to three plans.\n\n## Context\n\nChurn is concentrated in the legacy plans.\n')
    s.create('story', 'As a buyer I see three plans side by side', {
        'related_to': 'INI-0001', 'status': 'InProgress', 'redmine_id': '4522', 'redmine_url': 'https://redmine.example.com/issues/4522'})
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
    s.log_work('TSK-0001', 'Analysis', 'competitor list', y.isoformat())
    s.log_work('INI-0001', 'Meeting', 'kick-off', y.isoformat())
    s.log_work('TSK-0006', 'Testing', '', y.isoformat())
    s.log_work('TSK-0001', 'Analysis', 'captured plans', t.isoformat())
    s.log_work('TSK-0002', 'Definition', '', t.isoformat())
    return path


def seed_ticketing(path=TICKETING_VAULT):
    """The Ticketing sample: projects as folders, KEY-TYPE-NNN ids, every type of the structure."""
    fresh(path)
    for folder in (*ROOT_FOLDERS.values(), WORKLOG_FOLDER):
        os.makedirs(os.path.join(path, folder), exist_ok=True)
    s = Store(path, structure='ticketing', enforce_structure=True)
    t = date.today()
    y = t - timedelta(days=1)
    people_and_labels(s, ['checkout', 'billing', 'infra'])
    s.create('project', 'Acme Web', {'project_key': 'ACME', 'project_kind': 'product'},
             'The customer-facing shop: catalogue, cart and checkout.\n')
    s.create('project', 'Internal Tools', {'project_key': 'OPS', 'project_kind': 'system'},
             'The scripts and dashboards the team runs on.\n')
    ini = s.create('initiative', 'Checkout redesign', {'project': 'ACME', 'sidebar': True, 'labels': ['checkout']},
                   '## Goal\n\nA one-page checkout that keeps more carts.\n')['id']
    sup = s.create('support', 'Invoice email arrives empty', {'project': 'ACME', 'level': 'C2', 'origin': 'customer', 'labels': ['billing']},
                   'Two customers report an empty invoice email since the last release.\n')['id']
    s.create('support', 'Nightly backup took 3 hours', {'project': 'OPS', 'level': 'C1', 'labels': ['infra']})
    ops = s.create('initiative', 'Faster deploys', {'project': 'OPS', 'labels': ['infra'], 'sidebar': False})['id']
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
    s.create('hotfix', 'Restore the invoice template', {'project': 'ACME', 'related_to': sup, 'labels': ['billing']})
    s.create('prd', 'One-page checkout', {'project': 'ACME', 'related_to': ini},
             '## Problem\n\nFour steps lose a third of the carts.\n\n## Scope\n\nAddress, shipping and payment on one page.\n')
    s.create('plan', 'Plan', {'project': 'ACME', 'related_to': ini}, '1. Map the steps\n2. Prototype\n3. A/B test\n')
    s.create('analysis', 'Why carts are abandoned', {'project': 'ACME', 'related_to': ini})
    s.create('error', 'Coupon applied twice', {'project': 'ACME', 'related_to': sup})
    s.create('learning', 'Flags before big UI changes', {'project': 'ACME', 'related_to': ini})
    s.create('meeting', 'Checkout review', {'project': 'ACME', 'related_to': ini, 'date': y.isoformat(), 'time': '11:00',
                                            'attendees': ['Ana', 'Marta']}, '- Agreed on one page.\n')
    s.create('note', 'Payment providers', {'project': 'ACME', 'labels': ['checkout']}, '- Stripe\n- Adyen\n')
    s.create('agent', 'Support triage agent', {}, 'Reads new support tickets and suggests their level.\n')
    s.create('activity', 'Re: empty invoice', {'source': 'Email', 'from': 'Ana', 'related_to': sup, 'date': y.isoformat()},
             'Same here: the invoice email has no attachment and no total.\n')
    s.create('inbox', 'Try passkeys for login', {})
    s.make_folder('Docs/Team', parents=True)
    s.make_folder('Acme Web/Docs/Architecture', parents=True)
    s.create_file('Docs/Team/How we ship.md', '# How we ship\n\nEvery change goes through a pull request and a review.\n')
    s.create_file('Acme Web/Docs/Architecture/Overview.md', '# Overview\n\nA web shop in front of the payments API.\n')
    first_task = next(i['id'] for i in s.items() if i['type'] == 'task')
    s.log_work(first_task, 'Analysis', 'steps mapped', y.isoformat())
    s.log_work(ini, 'Meeting', 'review', y.isoformat())
    s.log_work(first_task, 'Definition', '', t.isoformat())
    return path


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
