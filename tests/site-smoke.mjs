import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'index.html');
const staleIndexPath = path.join(root, 'stale', 'old-homepage', 'index.html');
const staleLogoPath = path.join(root, 'stale', 'old-homepage', 'logo.png');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readUtf8(filePath) {
  return readFileSync(filePath, 'utf8');
}

function localAssetReferences(html) {
  const refs = [];
  const patterns = [
    /\bsrc="([^"]+)"/g,
    /\bposter="([^"]+)"/g,
    /url\(["']?([^"')]+)["']?\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = match[1];
      if (
        value.startsWith('#') ||
        value.startsWith('data:') ||
        value.startsWith('http://') ||
        value.startsWith('https://') ||
        value.startsWith('/cdn-cgi/')
      ) {
        continue;
      }
      refs.push(value);
    }
  }
  return refs;
}

assert(existsSync(indexPath), 'index.html must exist');
assert(existsSync(staleIndexPath), 'old homepage index.html must be preserved under stale/old-homepage');
assert(existsSync(staleLogoPath), 'old homepage logo.png must be preserved under stale/old-homepage');

const html = readUtf8(indexPath);

const requiredSnippets = [
  '感知空间 协同智能',
  '物理AI具身空间智能',
  '北京航空航天大学',
  '空间训练场',
  'COS',
  '碎蜂',
  '低空安全',
  '低空经济',
  '具身空间智能',
  '人才梯队',
];

for (const snippet of requiredSnippets) {
  assert(html.includes(snippet), `index.html must include core content: ${snippet}`);
}

const requiredIds = [
  'hero',
  'recent',
  'system',
  'scenarios',
  'solutions',
  'company',
  'research',
  'contact',
];

for (const id of requiredIds) {
  assert(html.includes(`id="${id}"`), `index.html must include section id="${id}"`);
}

for (const ref of localAssetReferences(html)) {
  const assetPath = path.join(root, decodeURI(ref));
  assert(existsSync(assetPath), `local asset reference must exist: ${ref}`);
}

console.log('site smoke checks passed');
