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

// tag → group label + Font Awesome icon (brands for platforms) + order.
// `sub: true` marks the tag whose endpoints are split into resource sub-groups.
const TAGS = {
  Profiles: { label: 'Profiles', icon: 'user', order: 1 },
  Connections: { label: 'Connections', icon: 'plug', order: 2 },
  Posts: { label: 'Posts', icon: 'paper-plane', order: 3 },
  Media: { label: 'Media', icon: 'image', order: 4 },
  'Google Ads': { label: 'Google Ads', icon: 'google', order: 5, sub: true },
  Meta: { label: 'Meta Ads', icon: 'meta', order: 6 },
  // TikTok Ads ships on a later deploy; mapped now so it auto-appears once live.
  'TikTok Ads': { label: 'TikTok Ads', icon: 'tiktok', order: 7 },
  TikTok: { label: 'TikTok', icon: 'tiktok', order: 8 },
  Webhooks: { label: 'Webhooks', icon: 'bell', order: 9 },
  Logs: { label: 'Logs', icon: 'list-check', order: 10 },
  Tokens: { label: 'Tokens', icon: 'key', order: 11 },
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

function build(spec) {
  const ops = operations(spec);
  const byTag = new Map();
  for (const op of ops) {
    if (!byTag.has(op.tag)) byTag.set(op.tag, []);
    byTag.get(op.tag).push(op);
  }

  const groups = [];
  const orderedTags = Object.entries(TAGS).sort((a, b) => a[1].order - b[1].order);
  for (const [tag, cfg] of orderedTags) {
    const tagOps = byTag.get(tag);
    if (!tagOps?.length) continue;
    groups.push(
      cfg.sub
        ? { ...buildGoogleAds(tagOps), group: cfg.label, icon: cfg.icon }
        : { group: cfg.label, icon: cfg.icon, pages: sortOps(tagOps).map(ref) },
    );
  }

  // Surface any tag we didn't map, so a new domain never silently vanishes.
  const unmapped = [...byTag.keys()].filter((t) => !TAGS[t]);
  if (unmapped.length) console.error('UNMAPPED TAGS (add to TAGS):', unmapped);

  return { tab: 'API Reference', icon: 'square-terminal', openapi: SPEC_URL, groups };
}

const spec = await loadSpec();
process.stdout.write(JSON.stringify(build(spec), null, 2) + '\n');
