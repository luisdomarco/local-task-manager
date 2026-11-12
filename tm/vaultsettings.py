"""A vault's own settings: what it shows, kept inside the vault (.task-manager/settings.json) so that every device that
opens the same folder — the Mac app, the iPhone app over iCloud Drive — sees the same vault. What only one device
knows (the vault's name in this app, its path here, whether it is the default) stays in that device's config.json.

It holds `disabled_types` (Settings → Vaults → Item types) and `disabled_features` (→ Features: FEATURES below). The
file is read on its own, with no Store, because
config.json is loaded before any store is opened; it is written only through Store.save_vault_settings (the vault's
lock, atomic)."""
import json
import os

DIR = '.task-manager'
FILE = 'settings.json'
KEYS = ('disabled_types', 'disabled_features')  # what the file may hold; anything else in it is kept as it is, never read

# What a vault may turn off as a whole (Settings → Vaults → Features): its id (what features.js has() asks), its name,
# what it hides, and the item types that go with it (turned off with it, as Item types turns them off). With
# `follows_types` the feature is off too once every one of its types is off (the Activity tab with the Activity type).
# Nothing is ever deleted: turned on again, everything is back.
FEATURES = (
    {'id': 'agents', 'label': 'AI Agents', 'types': ('agent', 'prompt'), 'follows_types': False,
     'hides': 'Agents and Prompts, an item’s AI Agents tab and Claude button, the sidebar’s Agents mode and its runs'},
    {'id': 'canvas', 'label': 'Canvas', 'types': (), 'follows_types': False,
     'hides': 'the Canvas page, an item’s Canvas tab and the Goals page’s canvas layout'},
    {'id': 'inbox', 'label': 'Inbox', 'types': ('inbox',), 'follows_types': True,
     'hides': 'the Inbox and its quick capture (Q, Capture to Inbox)'},
    {'id': 'activity', 'label': 'Activity', 'types': ('activity',), 'follows_types': True,
     'hides': 'Activities and an item’s Activity tab (its comments and history)'},
    {'id': 'goals', 'label': 'Goals', 'types': ('goal',), 'follows_types': True,
     'hides': 'Goals, an item’s goal and the lists’ goal column and grouping'},
    {'id': 'graph', 'label': 'Graph', 'types': (), 'follows_types': False,
     'hides': 'the Graph page and Show in graph'},
    {'id': 'meetings', 'label': 'Meetings & transcription', 'types': ('meeting', 'transcription'), 'follows_types': True,
     'hides': 'Meetings and Transcriptions, and their place in Today and the Month'},
    {'id': 'worklog', 'label': 'Work log', 'types': (), 'follows_types': False,
     'hides': 'the Work log page, an item’s Time tab and the minutes in Today'},
    {'id': 'contacts', 'label': 'Contacts', 'types': (), 'follows_types': False,
     'hides': 'the Contacts page, @ mentions and an item’s watchers (attendees stay, as plain names)'},
)
FEATURE_IDS = tuple(f['id'] for f in FEATURES)


def feature_types(disabled_features, types):
    """The item types the features turned off take with them, among `types` (a structure's), in its order."""
    off = set(disabled_features or ())
    return [t for t in types if any(t in f['types'] for f in FEATURES if f['id'] in off)]


def features_off(disabled_features, disabled_types, types):
    """The features off in a vault: those it turned off, and those whose types (among the structure's `types`) Item
    types turned all off (`follows_types`). In FEATURES' order."""
    off, gone = set(disabled_features or ()), set(disabled_types or ())
    for f in FEATURES:
        mine = [t for t in f['types'] if t in types]
        if f['follows_types'] and mine and all(t in gone for t in mine):
            off.add(f['id'])
    return [i for i in FEATURE_IDS if i in off]


def path(root):
    return os.path.join(root, DIR, FILE)


def read(root):
    """The vault's settings, or None when it keeps none (no file, a folder that is gone, or a file that is not a JSON
    object: then the device's own config is used, as before the file existed)."""
    try:
        with open(path(root), encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None
