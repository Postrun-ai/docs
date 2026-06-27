#!/usr/bin/env node
// Generates the "API Reference" tab navigation for docs.json from the live
// OpenAPI spec — icon-bearing groups by domain, platform brand marks, and the
// large Google Ads surface split into resource sub-groups. Re-run after the API
// adds endpoints so the reference stays in sync.
//
//   node scripts/build-api-nav.mjs            # fetch the live spec
//   node scripts/build-api-nav.mjs <file>     # use a local spec file
//
// Prints the JSON for the API Reference tab to stdout.

import { readFileSync } from 'node:fs';

const SPEC_URL = 'https://api.postrun.ai/v1/openapi.json';

// tag → group label + Font Awesome icon (brands for platforms) + order + section.
// `sub: true` marks the tag whose endpoints are split into resource sub-groups.
// Platform groups use official self-hosted brand SVGs (logos/*.svg); the rest use
// Font Awesome names. `section` routes the group to the Social and/or Ads tab —
// `core` (auth/profiles/connections/webhooks/logs) appears in BOTH so each tab is
// self-contained for its pricing tier. Tokens is FIRST — minting a token is step zero.
const TAGS = {
  Tokens: { label: 'Tokens', icon: 'key', order: 0, section: 'core' },
  Profiles: { label: 'Profiles', icon: 'user', order: 1, section: 'core' },
  Connections: { label: 'Connections', icon: 'plug', order: 2, section: 'core' },
  Posts: { label: 'Posts', icon: 'paper-plane', order: 3, section: 'social' },
  Media: { label: 'Media', icon: 'image', order: 4, section: 'social' },
  TikTok: { label: 'TikTok', icon: '/logos/tiktok.svg', order: 5, section: 'social' },
  'Google Ads': { label: 'Google Ads', icon: '/logos/google-ads.svg', order: 6, sub: true, section: 'ads' },
  Meta: { label: 'Meta Ads', icon: '/logos/meta.svg', order: 7, section: 'ads' },
  // TikTok Ads ships on a later deploy; mapped now so it auto-appears once live.
  'TikTok Ads': { label: 'TikTok Ads', icon: '/logos/tiktok.svg', order: 8, section: 'ads' },
  Webhooks: { label: 'Webhooks', icon: 'bell', order: 9, section: 'core' },
  Logs: { label: 'Logs', icon: 'list-check', order: 10, section: 'core' },
};

// Google Ads resource sub-groups, in display order. Each predicate runs on the
// path with the `/google/{connection_id}/` prefix stripped.
const GA_SUBGROUPS = [
  ['Campaigns', (p) => p.startsWith('campaigns')],
  ['Ad groups', (p) => p.startsWith('ad-groups')],
  ['Ads', (p) => p === 'ads' || p.startsWith('ads/') || p.startsWith('display-ads')],
  ['Keywords', (p) => p.startsWith('keywords')],
  ['Audiences', (p) => p.startsWith('audiences') || p.startsWith('geo-targets')],
  ['Conversions', (p) => p.startsWith('conversion') || p.startsWith('conversions')],
  ['Budgets', (p) => p.startsWith('budgets')],
  ['Assets', (p) => p.startsWith('assets')],
  ['Reporting', (p) => p.startsWith('insights') || p.startsWith('gaql')],
  ['Account', (p) => p.startsWith('account') || p.startsWith('url-settings')],
];

const METHOD_ORDER = { get: 0, post: 1, put: 2, patch: 3, delete: 4 };

async function loadSpec() {
  const arg = process.argv[2];
  if (arg) return JSON.parse(readFileSync(arg, 'utf8'));
  const res = await fetch(SPEC_URL);
  if (!res.ok) throw new Error(`spec fetch failed: ${res.status}`);
  return res.json();
}

function operations(spec) {
  const ops = [];
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (!METHOD_ORDER.hasOwnProperty(method)) continue;
      ops.push({ path, method, tag: (op.tags ?? ['(untagged)'])[0] });
    }
  }
  return ops;
}

// Stable order within a group: by path, then by HTTP method.
function sortOps(ops) {
  return [...ops].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      METHOD_ORDER[a.method] - METHOD_ORDER[b.method],
  );
}

const ref = (op) => `${op.method.toUpperCase()} ${op.path}`;

function gaSubgroup(path) {
  const rest = path.replace(/^\/google\/\{connection_id\}\//, '');
  for (const [label, match] of GA_SUBGROUPS) if (match(rest)) return label;
  return 'Other';
}

function buildGoogleAds(ops) {
  const buckets = new Map(GA_SUBGROUPS.map(([label]) => [label, []]));
  buckets.set('Other', []);
  for (const op of ops) buckets.get(gaSubgroup(op.path)).push(op);

  const pages = [];
  for (const [label] of [...GA_SUBGROUPS, ['Other']]) {
    const inGroup = buckets.get(label);
    if (inGroup.length) pages.push({ group: label, pages: sortOps(inGroup).map(ref) });
  }
  return { group: 'Google Ads', icon: 'google', pages };
}

function buildGroup(cfg, ops) {
  return cfg.sub
    ? { ...buildGoogleAds(ops), group: cfg.label, icon: cfg.icon }
    : { group: cfg.label, icon: cfg.icon, pages: sortOps(ops).map(ref) };
}

// Two tabs: Social and Ads. Each operation lives in EXACTLY ONE tab — Mintlify
// conflicts when the same operation appears under two tabs. The shared `core`
// groups (auth/profiles/connections/webhooks/logs) live in the Social tab (the
// foundational API); the Ads tab is purely the ad platforms.
function build(spec) {
  const ops = operations(spec);
  const byTag = new Map();
  for (const op of ops) {
    if (!byTag.has(op.tag)) byTag.set(op.tag, []);
    byTag.get(op.tag).push(op);
  }

  const built = []; // { section, group } in display order
  const orderedTags = Object.entries(TAGS).sort((a, b) => a[1].order - b[1].order);
  for (const [tag, cfg] of orderedTags) {
    const tagOps = byTag.get(tag);
    if (!tagOps?.length) continue;
    built.push({ section: cfg.section, group: buildGroup(cfg, tagOps) });
  }

  // Surface any tag we didn't map, so a new domain never silently vanishes.
  const unmapped = [...byTag.keys()].filter((t) => !TAGS[t]);
  if (unmapped.length) console.error('UNMAPPED TAGS (add to TAGS):', unmapped);

  const groupsFor = (sections) =>
    built.filter((b) => sections.includes(b.section)).map((b) => b.group);

  return [
    { tab: 'Social API', icon: 'share-nodes', openapi: SPEC_URL, groups: groupsFor(['core', 'social']) },
    { tab: 'Ads API', icon: 'bullhorn', openapi: SPEC_URL, groups: groupsFor(['ads']) },
  ];
}

const spec = await loadSpec();
process.stdout.write(JSON.stringify(build(spec), null, 2) + '\n');
