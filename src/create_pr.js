#!/usr/bin/env node
/**
 * create_pr.js — Fork-based Pull Request creator for waimao_scraper
 *
 * Usage:
 *   node src/create_pr.js --branch "fix/region-filter" --title "Fix region filter" --body "Description" [--base main] [--files "file1.js file2.js"]
 *
 * Workflow (fork-based contribution model):
 *   1. Creates a local branch from main
 *   2. Stages & commits changes
 *   3. Pushes to the user's fork remote
 *   4. Creates a cross-repo PR (fork:branch → origin:main) via GitHub API
 *
 * Requires two git remotes configured during setup:
 *   origin → upstream repo (jinyanghe1/waimao_scraper) with owner token
 *   fork   → user's fork (RosaHuayangYE/waimao-scraper) with user token
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function git(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: SKILL_DIR,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...opts,
  }).trim();
}

function parseRemoteUrl(remoteName) {
  const url = git(`git remote get-url ${remoteName}`);
  const m = url.match(/^https?:\/\/([^:/@]+):([^@/]+)@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) return null;
  return { user: m[1], token: m[2], owner: m[3], repo: m[4] };
}

async function createPR(branch, title, body, base, filesArg) {
  const forkRemote = parseRemoteUrl('fork');
  const originRemote = parseRemoteUrl('origin');

  if (!forkRemote) {
    console.error('✗ Cannot parse "fork" remote (user fork not configured)');
    console.error('  Run setup first to configure the fork remote');
    process.exit(1);
  }
  if (!originRemote) {
    console.error('✗ Cannot parse "origin" remote');
    process.exit(1);
  }

  const forkUser = forkRemote.owner;
  const forkToken = forkRemote.token;
  const upstreamOwner = originRemote.owner;
  const upstreamRepo = originRemote.repo;
  const upstreamApi = `https://api.github.com/repos/${upstreamOwner}/${upstreamRepo}`;

  // 1. Create local branch
  console.log(`→ Creating local branch "${branch}" from "main"...`);
  try {
    git(`git checkout -b ${branch}`);
  } catch {
    try {
      git(`git checkout ${branch}`);
    } catch {
      console.error(`✗ Cannot create/checkout branch "${branch}"`);
      process.exit(1);
    }
  }

  // 2. Stage and commit changes
  console.log(`→ Staging changes...`);
  if (filesArg) {
    git(`git add ${filesArg}`);
  } else {
    git('git add -A');
  }

  const status = git('git status --porcelain');
  if (!status) {
    console.log('  ⊙ No changes to commit, continuing with existing branch state...');
  } else {
    const commitMsg = title.replace(/"/g, '\\"');
    git(`git commit -m "${commitMsg}"`);
    console.log(`  ✓ Committed: ${title}`);
  }

  // 3. Push to user's fork
  console.log(`→ Pushing to fork (${forkUser}/waimao-scraper)...`);
  try {
    git(`git push fork ${branch}`);
    console.log(`  ✓ Pushed to fork`);
  } catch {
    console.log(`  ⊙ Push failed, trying force push...`);
    try {
      git(`git push fork ${branch} --force`);
      console.log(`  ✓ Force pushed to fork`);
    } catch {
      console.error(`✗ Failed to push to fork`);
      git('git checkout main');
      process.exit(1);
    }
  }

  // 4. Create cross-repo PR via API
  console.log(`→ Creating Pull Request (${forkUser}:${branch} → ${upstreamOwner}:${base})...`);
  const prRes = await fetch(`${upstreamApi}/pulls`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${forkToken}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'waimao-scraper',
    },
    body: JSON.stringify({
      title,
      body: body || title,
      head: `${forkUser}:${branch}`,
      base,
    }),
  });

  // Switch back to main
  git('git checkout main');

  if (prRes.ok) {
    const prData = await prRes.json();
    console.log(`\n✓ Pull Request created: ${prData.html_url}`);
    console.log(`  PR #${prData.number}: ${prData.title}`);
    console.log(`  ${forkUser}:${branch} → ${upstreamOwner}:${base}`);
    return prData;
  } else {
    const errData = await prRes.json().catch(() => ({}));
    if (errData.message && errData.message.includes('already exists')) {
      console.log(`\n⊙ A PR already exists for ${forkUser}:${branch} → ${upstreamOwner}:${base}`);
    } else {
      console.error(`✗ Failed to create PR: HTTP ${prRes.status} - ${errData.message || ''}`);
      process.exit(1);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.branch || !args.title) {
    console.error('Usage: node src/create_pr.js --branch "fix/something" --title "PR title" --body "Description" [--base main] [--files "file1.js file2.js"]');
    process.exit(2);
  }

  const branch = args.branch;
  const title = args.title;
  const body = args.body || '';
  const base = args.base || 'main';
  const filesArg = args.files || '';

  await createPR(branch, title, body, base, filesArg);
}

// Run if called directly
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
