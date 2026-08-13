import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pageNames = ['index.html', 'about.html'];
const supportNames = ['styles.css', 'site.js', 'contact-form.mjs'];
const archiveIndexPath = path.join(root, 'stale', 'old-homepage', 'index.html');
const archiveLogoPath = path.join(root, 'stale', 'old-homepage', 'logo.png');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readUtf8(filePath) {
  assert(existsSync(filePath), `required file must exist: ${path.relative(root, filePath)}`);
  const contents = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  assert(!contents.includes('\uFFFD'), `file must be valid UTF-8: ${path.relative(root, filePath)}`);
  return contents;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}

function visibleText(html) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

function compactText(value) {
  return value.replace(/\s+/g, '').toLowerCase();
}

function assertVisibleIncludes(html, expected, context) {
  assert(
    compactText(visibleText(html)).includes(compactText(expected)),
    `${context} must include visible copy: ${expected}`,
  );
}

function assertVisibleExcludes(html, unexpected, context) {
  assert(
    !compactText(visibleText(html)).includes(compactText(unexpected)),
    `${context} must not include removed copy: ${unexpected}`,
  );
}

function openingTags(html, tagName) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))].map((match) => match[0]);
}

function pairedElements(html, tagName) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'gi'))].map(
    (match) => match[0],
  );
}

function getAttribute(tag, name) {
  const match = tag.match(
    new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

function hasAttribute(tag, name) {
  return new RegExp(`\\s${escapeRegExp(name)}(?:\\s*=|(?=\\s|/?>))`, 'i').test(tag);
}

function elementOpeningTag(element) {
  return element.slice(0, element.indexOf('>') + 1);
}

function extractIds(html) {
  const ids = [];
  for (const tag of html.matchAll(/<[a-z][^>]*>/gi)) {
    const id = getAttribute(tag[0], 'id');
    if (id !== null) ids.push(id);
  }
  return ids;
}

function assertUniqueIds(page) {
  const seen = new Set();
  for (const id of extractIds(page.html)) {
    assert(id.length > 0, `${page.name} must not contain an empty id`);
    assert(!seen.has(id), `${page.name} must not contain duplicate id="${id}"`);
    seen.add(id);
  }
  return seen;
}

function safeDecodeUri(value, context) {
  try {
    return decodeURI(value);
  } catch (error) {
    throw new Error(`${context} contains invalid URI encoding: ${value}; ${error.message}`);
  }
}

function isExternalReference(value) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);
}

function localReferencePath(value, sourcePath, context) {
  const withoutFragment = value.split('#', 1)[0];
  const withoutQuery = withoutFragment.split('?', 1)[0];
  assert(withoutQuery.length > 0, `${context} must not be empty`);
  const decoded = safeDecodeUri(withoutQuery, context);
  const resolved = path.resolve(path.dirname(sourcePath), decoded);
  const relative = path.relative(root, resolved);
  assert(
    relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    `${context} must stay inside the website root: ${value}`,
  );
  return resolved;
}

function assertLocalResources(page, css) {
  const references = [];
  for (const tagName of ['img', 'script', 'source']) {
    for (const tag of openingTags(page.html, tagName)) {
      const src = getAttribute(tag, 'src');
      if (src !== null) references.push({ attribute: 'src', value: src });

      const srcset = getAttribute(tag, 'srcset');
      if (srcset !== null) {
        for (const candidate of srcset.split(',')) {
          references.push({ attribute: 'srcset', value: candidate.trim().split(/\s+/, 1)[0] });
        }
      }
    }
  }

  for (const tag of openingTags(page.html, 'video')) {
    const poster = getAttribute(tag, 'poster');
    if (poster !== null) references.push({ attribute: 'poster', value: poster });
  }

  for (const tag of openingTags(page.html, 'link')) {
    const href = getAttribute(tag, 'href');
    if (href !== null) references.push({ attribute: 'href', value: href });
  }

  for (const reference of references) {
    const value = reference.value.trim();
    assert(value.length > 0, `${page.name} has an empty ${reference.attribute} resource reference`);
    if (value.startsWith('data:') || value.startsWith('blob:') || isExternalReference(value)) continue;
    assert(!value.includes('stale/old-homepage'), `${page.name} must not serve assets from the archive`);
    const resolved = localReferencePath(value, page.path, `${page.name} ${reference.attribute}`);
    assert(existsSync(resolved), `${page.name} local resource must exist: ${value}`);
    assert(statSync(resolved).isFile(), `${page.name} local resource must be a file: ${value}`);
  }

  if (page.name === 'index.html') {
    for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      const value = match[1].trim();
      if (value.startsWith('data:') || isExternalReference(value)) continue;
      const resolved = localReferencePath(value, path.join(root, 'styles.css'), 'styles.css url()');
      assert(existsSync(resolved), `styles.css local resource must exist: ${value}`);
      assert(statSync(resolved).isFile(), `styles.css local resource must be a file: ${value}`);
    }
  }
}

function assertLinksAndFragments(page, pagesByPath) {
  const currentIds = new Set(extractIds(page.html));

  for (const element of pairedElements(page.html, 'a')) {
    const tag = elementOpeningTag(element);
    const href = getAttribute(tag, 'href');
    const label = visibleText(element);
    assert(href !== null && href.trim().length > 0, `${page.name} link "${label}" must have a non-empty href`);
    assert(!/^javascript:/i.test(href), `${page.name} must not use javascript: links: ${label}`);

    const target = getAttribute(tag, 'target');
    const relTokens = new Set((getAttribute(tag, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean));
    if (target?.toLowerCase() === '_blank') {
      assert(relTokens.has('noopener'), `${page.name} target="_blank" link must include rel="noopener": ${href}`);
    }

    if (isExternalReference(href)) {
      if (/^https?:/i.test(href)) {
        assert(target?.toLowerCase() === '_blank', `${page.name} external web link must open in a new tab: ${href}`);
        assert(relTokens.has('noopener'), `${page.name} external web link must include rel="noopener": ${href}`);
      }
      continue;
    }

    const hashIndex = href.indexOf('#');
    const pathPart = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
    const fragment = hashIndex >= 0 ? safeDecodeUri(href.slice(hashIndex + 1), `${page.name} link`) : '';
    let targetPath = page.path;
    let targetIds = currentIds;

    if (pathPart.length > 0) {
      targetPath = localReferencePath(pathPart, page.path, `${page.name} link`);
      assert(existsSync(targetPath), `${page.name} local link target must exist: ${href}`);
      const normalizedTarget = path.normalize(targetPath).toLowerCase();
      const targetPage = pagesByPath.get(normalizedTarget);
      if (targetPage) targetIds = new Set(extractIds(targetPage.html));
      else if (fragment.length > 0) {
        assert(false, `${page.name} fragment link must target one of the two public HTML pages: ${href}`);
      }
    }

    if (fragment.length > 0) {
      assert(targetIds.has(fragment), `${page.name} fragment link must resolve to id="${fragment}": ${href}`);
    }
  }

  for (const attributeName of ['aria-controls', 'aria-labelledby', 'aria-describedby']) {
    const pattern = new RegExp(`\\s${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'gi');
    for (const match of page.html.matchAll(pattern)) {
      const idRefs = (match[1] ?? match[2]).trim().split(/\s+/).filter(Boolean);
      assert(idRefs.length > 0, `${page.name} ${attributeName} must reference at least one id`);
      for (const idRef of idRefs) {
        assert(currentIds.has(idRef), `${page.name} ${attributeName} must resolve to id="${idRef}"`);
      }
    }
  }
}

function assertSingleH1(page, expected) {
  const headings = pairedElements(page.html, 'h1');
  assert(headings.length === 1, `${page.name} must contain exactly one h1; found ${headings.length}`);
  assert(
    compactText(visibleText(headings[0])) === compactText(expected),
    `${page.name} h1 must be "${expected}"; found "${visibleText(headings[0])}"`,
  );
}

function firstIndex(html, pattern, context) {
  const index = html.search(pattern);
  assert(index >= 0, `index.html must contain narrative stage: ${context}`);
  return index;
}

function assertNarrativeOrder(indexHtml) {
  const stages = [
    ['hero', /<section\b[^>]*class="[^"]*\bhero\b/i],
    ['theory', /<section\b[^>]*id="theory"/i],
    ['products', /<section\b[^>]*id="products"/i],
    ['applications', /<section\b[^>]*id="applications"/i],
    ['contact', /<section\b[^>]*id="contact"/i],
  ];
  const positions = stages.map(([name, pattern]) => [name, firstIndex(indexHtml, pattern, name)]);
  for (let index = 1; index < positions.length; index += 1) {
    assert(
      positions[index - 1][1] < positions[index][1],
      `homepage narrative must place ${positions[index - 1][0]} before ${positions[index][0]}`,
    );
  }

  const productSlice = indexHtml.slice(positions[2][1], positions[3][1]);
  const productNames = ['空间训练场', 'COS 协同操作系统', '碎蜂低空安防系统'];
  let previous = -1;
  for (const productName of productNames) {
    const position = compactText(visibleText(productSlice)).indexOf(compactText(productName));
    assert(position >= 0, `product section must include ${productName}`);
    assert(position > previous, `product section must order products as training → COS → 碎蜂`);
    previous = position;
  }
}

function assertNoEnglishEntry(page) {
  assert(/<html\b[^>]*\blang=["']zh-CN["']/i.test(page.html), `${page.name} must declare lang="zh-CN"`);
  assert(!/\bhreflang=["']en(?:-[^"']+)?["']/i.test(page.html), `${page.name} must not expose an English hreflang entry`);

  for (const element of pairedElements(page.html, 'a')) {
    const tag = elementOpeningTag(element);
    const label = visibleText(element).trim();
    const href = getAttribute(tag, 'href') ?? '';
    assert(!/^(?:en|english|英文)$/i.test(label), `${page.name} must not expose an English-site entry`);
    assert(!/(?:^|\/)en(?:[./?#]|$)/i.test(href), `${page.name} must not link to an English-site route: ${href}`);
  }
}

function assertBusinessContentBoundaries(pages) {
  const forbidden = [
    ['全球首个', /全球首个/i],
    ['世界级', /世界级/i],
    ['90+%', /90\s*\+?\s*%/i],
    ['300km/h', /300\s*km\s*\/?\s*h/i],
    ['精准制导', /精准制导/i],
    ['融资', /融资/i],
    ['估值', /估值/i],
    ['收入/营收', /(?:收入|营收)/i],
    ['竞品', /竞品/i],
    ['路线图', /路线图/i],
    ['市场规模', /市场规模/i],
    ['天使轮/Pre-A/A轮', /(?:天使轮|pre[-\s]?a|a\s*轮)/i],
  ];

  for (const page of pages) {
    const text = visibleText(page.html);
    for (const [label, pattern] of forbidden) {
      assert(!pattern.test(text), `${page.name} must not publish prohibited or PPT-only claim: ${label}`);
    }
    assert(
      !/assets\/v2\/research\/industry-partners\//i.test(page.html),
      `${page.name} must not infer public partnerships from unapproved industry-logo assets`,
    );
    assert(
      !/assets\/v2\/research\/schools\//i.test(page.html),
      `${page.name} must not publish removed research-network school logos`,
    );
  }
}

function probeVideo(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const result = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,pix_fmt',
      '-of',
      'json',
      absolutePath,
    ],
    { encoding: 'utf8', windowsHide: true },
  );

  if (result.error) {
    const reason = result.error.code === 'ENOENT'
      ? 'ffprobe is required for V2 video compatibility checks but was not found on PATH'
      : `ffprobe could not start: ${result.error.message}`;
    throw new Error(reason);
  }
  assert(result.status === 0, `ffprobe failed for ${relativePath}: ${result.stderr.trim() || `exit ${result.status}`}`);

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`ffprobe returned invalid JSON for ${relativePath}: ${error.message}`);
  }
  const stream = payload.streams?.[0];
  assert(stream, `${relativePath} must contain a readable video stream`);
  assert(stream.codec_name === 'h264', `${relativePath} must use H.264; found ${stream.codec_name ?? 'unknown'}`);
  assert(stream.pix_fmt === 'yuv420p', `${relativePath} must use yuv420p; found ${stream.pix_fmt ?? 'unknown'}`);
}

function assertVideos(indexHtml) {
  const videos = [...indexHtml.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi)];
  const expected = [
    ['video-training', 'assets/v2/products/training.mp4', 'assets/v2/products/training-poster.jpg'],
    ['video-cos', 'assets/v2/products/cos.mp4', 'assets/v2/products/cos-poster.jpg'],
  ];
  assert(videos.length === expected.length, `index.html must contain exactly two product videos; found ${videos.length}`);

  const frames = [...indexHtml.matchAll(/<div\b[^>]*data-video-frame[^>]*>([\s\S]*?)<\/div>/gi)];
  assert(frames.length === expected.length, `index.html must contain one fallback frame per product video`);

  for (const [id, sourcePath, posterPath] of expected) {
    const video = videos.find((match) => getAttribute(`<video${match[1]}>`, 'id') === id);
    assert(video, `index.html must contain product video id="${id}"`);
    const tag = `<video${video[1]}>`;
    assert(getAttribute(tag, 'poster') === posterPath, `${id} must use poster ${posterPath}`);
    for (const attribute of ['muted', 'loop', 'playsinline']) {
      assert(hasAttribute(tag, attribute), `${id} must include ${attribute}`);
    }
    assert(!hasAttribute(tag, 'autoplay'), `${id} must not autoplay`);
    assert(getAttribute(tag, 'preload') === 'metadata', `${id} must use preload="metadata"`);

    const sourceTags = openingTags(video[2], 'source');
    assert(sourceTags.length === 1, `${id} must contain exactly one video source`);
    assert(getAttribute(sourceTags[0], 'src') === sourcePath, `${id} must use source ${sourcePath}`);
    assert(getAttribute(sourceTags[0], 'type') === 'video/mp4', `${id} source must declare type="video/mp4"`);

    const frame = frames.find((match) => match[1].includes(`id="${id}"`));
    assert(frame, `${id} must be wrapped by a data-video-frame fallback container`);
    const button = openingTags(frame[1], 'button').find((candidate) => hasAttribute(candidate, 'data-video-toggle'));
    assert(button, `${id} must have a custom play/pause button`);
    assert(getAttribute(button, 'aria-controls') === id, `${id} button aria-controls must reference the video`);
    assert(getAttribute(button, 'aria-pressed') === 'false', `${id} button must expose its initial paused state`);
    assertVisibleIncludes(frame[1], '视频暂不可用，请查看产品文字说明。', `${id} fallback`);

    probeVideo(sourcePath.split('?')[0]);
  }

  const shardBeeImage = openingTags(indexHtml, 'img').find(
    (tag) => getAttribute(tag, 'src') === 'assets/v2/products/shard-bee-drone-landscape.jpg',
  );
  assert(shardBeeImage, 'the Shard Bee product must use its approved static product image');
  assert((getAttribute(shardBeeImage, 'alt') ?? '').trim().length > 0, 'the Shard Bee product image must have meaningful alt text');
}

const rootHtmlFiles = readdirSync(root)
  .filter((name) => name.toLowerCase().endsWith('.html'))
  .sort();
assert(
  JSON.stringify(rootHtmlFiles) === JSON.stringify([...pageNames].sort()),
  `website root must expose exactly the two public pages; found ${rootHtmlFiles.join(', ')}`,
);

const pages = pageNames.map((name) => {
  const pagePath = path.join(root, name);
  return { html: readUtf8(pagePath), name, path: pagePath };
});
const pagesByName = new Map(pages.map((page) => [page.name, page]));
const pagesByPath = new Map(pages.map((page) => [path.normalize(page.path).toLowerCase(), page]));
const styles = readUtf8(path.join(root, supportNames[0]));
const siteScript = readUtf8(path.join(root, supportNames[1]));
const contactFormScript = readUtf8(path.join(root, supportNames[2]));
const indexPage = pagesByName.get('index.html');
const aboutPage = pagesByName.get('about.html');

// Shared document integrity and AS-6 navigation/resource reachability.
for (const page of pages) {
  assertUniqueIds(page);
  assert(/<meta\b[^>]*name=["']viewport["']/i.test(page.html), `${page.name} must include a viewport meta tag`);
  assertVisibleIncludes(page.html, '跳到主要内容', `${page.name} accessibility navigation`);
  assert(/<main\b[^>]*id=["']main-content["']/i.test(page.html), `${page.name} must expose main-content`);
  assert(/<script\b[^>]*src=["']site\.js(?:\?[^"']*)?["'][^>]*defer/i.test(page.html), `${page.name} must load shared site.js with defer`);
  assert(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']styles\.css(?:\?[^"']*)?["']/i.test(page.html), `${page.name} must load shared styles.css`);
  assertLinksAndFragments(page, pagesByPath);
  assertLocalResources(page, styles);
  assertNoEnglishEntry(page);
}

assertSingleH1(indexPage, '协同世界模型：具身智能时代的新范式');
assertSingleH1(aboutPage, '面向物理 AI 的具身空间智能公司');
const aboutTitle = pairedElements(aboutPage.html, 'h1')[0];
const aboutTitleLines = pairedElements(aboutTitle, 'span').filter((element) =>
  /class=["'][^"']*\babout-title-line\b[^"']*["']/i.test(elementOpeningTag(element)),
);
assert(aboutTitleLines.length === 2, 'about hero title must render as exactly two intentional lines');
assert(
  visibleText(aboutTitleLines[0]) === '面向物理 AI 的' && visibleText(aboutTitleLines[1]) === '具身空间智能公司',
  'about hero title must break after 的 without splitting 具身',
);

// AS-1: the first viewport communicates the category, value, and two next actions.
for (const copy of [
  '墨悉构建协同世界模型',
  '连接智能体 · 连接真实世界 · 连接未来产业',
  '商务合作',
  '观看产品 Demo',
]) {
  assertVisibleIncludes(indexPage.html, copy, 'AS-1 homepage hero');
}
assert(/<a\b[^>]*href=["']#contact["'][^>]*>[\s\S]*?商务合作[\s\S]*?<\/a>/i.test(indexPage.html), 'AS-1 hero must link 商务合作 to #contact');
assert(/<a\b[^>]*href=["']#products["'][^>]*>[\s\S]*?产品\s*Demo[\s\S]*?<\/a>/i.test(indexPage.html), 'AS-1 hero must link the product Demo action to #products');

// AS-2: the theory section focuses on collaborative intelligence without obsolete era tabs.
assertVisibleIncludes(indexPage.html, '协同智能时代', 'AS-2 theory section');
assert(
  /<span\b[^>]*class=["'][^"']*\bparadigm-title-zh\b[^"']*["'][^>]*>\s*协同智能时代\s*<\/span>/i.test(indexPage.html),
  'AS-2 collaborative intelligence label must not retain a section number',
);
for (const copy of ['单智能体时代', '多智能体时代']) {
  assertVisibleExcludes(indexPage.html, copy, 'AS-2 retired theory eras');
}
for (const copy of ['三个机制，让协同成为系统能力', '资源约束机制', '协同推理机制', '奖惩分配机制']) {
  assertVisibleExcludes(indexPage.html, copy, 'AS-2 simplified theory section');
}
assert(openingTags(indexPage.html, 'button').every((tag) => getAttribute(tag, 'role') !== 'tab'), 'AS-2 must not expose obsolete theory tabs');
assert(
  openingTags(indexPage.html, 'article').every((tag) => getAttribute(tag, 'role') !== 'tabpanel'),
  'AS-2 must not expose obsolete theory tab panels',
);
assert(!siteScript.includes('[data-tab-list]'), 'AS-2 must not retain obsolete theory tab behavior');

// AS-3 and homepage storytelling order.
assertNarrativeOrder(indexPage.html);
for (const copy of ['Train / 训练', 'Orchestrate / 协同调度', 'Execute / 执行']) {
  assertVisibleIncludes(indexPage.html, copy, 'AS-3 product role');
}
const productDownload = pairedElements(indexPage.html, 'a').find((element) =>
  /class=["'][^"']*\bproduct-download-link\b[^"']*["']/i.test(elementOpeningTag(element)),
);
assert(productDownload, 'AS-3 must expose the product-atlas download action');
const productDownloadTag = elementOpeningTag(productDownload);
assert(
  getAttribute(productDownloadTag, 'href') === 'assets/v2/products/shard-bee-product-brochure.pdf',
  'AS-3 product download must target the published product atlas',
);
assert(
  getAttribute(productDownloadTag, 'download') === '碎蜂产品手册.pdf',
  'AS-3 product atlas must use the descriptive 碎蜂产品手册.pdf download name',
);
assertVisibleIncludes(productDownload, '点击下载 PDF', 'AS-3 product download action');
assert(
  statSync(path.join(root, 'assets/v2/products/shard-bee-product-brochure.pdf')).size < 100 * 1024 * 1024,
  'AS-3 product atlas must remain below the GitHub 100 MB single-file limit',
);

// AS-4: four named applications, one corresponding image and capability description each.
const applicationsStart = firstIndex(indexPage.html, /<section\b[^>]*id="applications"/i, 'applications');
const contactStart = firstIndex(indexPage.html, /<section\b[^>]*id="contact"/i, 'contact');
const applicationsHtml = indexPage.html.slice(applicationsStart, contactStart);
const applicationTiles = openingTags(applicationsHtml, 'article').filter((tag) => /\bapplication-tile\b/.test(getAttribute(tag, 'class') ?? ''));
assert(applicationTiles.length === 4, `AS-4 must expose exactly four application tiles; found ${applicationTiles.length}`);
for (const copy of ['智慧城市与园区管理', '智慧矿区与工业制造', '复杂巡检与应急救援', '国防安全与商业航天']) {
  assertVisibleIncludes(applicationsHtml, copy, 'AS-4 applications');
}
const applicationImages = openingTags(applicationsHtml, 'img').filter((tag) =>
  (getAttribute(tag, 'src') ?? '').startsWith('assets/v2/applications/'),
);
assert(applicationImages.length === 4, 'AS-4 must provide one image for each application');
for (const image of applicationImages) {
  assert((getAttribute(image, 'alt') ?? '').trim().length > 0, 'AS-4 application images must have meaningful alt text');
}

// AS-5: approved company evidence only.
for (const copy of ['悉尼大学 TML 实验室', '2025 年 9 月落户杭州', '公司动态', '一起让协同智能进入真实世界']) {
  assertVisibleIncludes(aboutPage.html, copy, 'AS-5 company evidence');
}
assertBusinessContentBoundaries(pages);

// AS-6: every page has desktop/mobile navigation, understandable current state, and contact reachability.
for (const page of pages) {
  const menuButtons = openingTags(page.html, 'button').filter((tag) => hasAttribute(tag, 'data-menu-button'));
  assert(menuButtons.length === 1, `${page.name} must contain one mobile menu button`);
  assert(getAttribute(menuButtons[0], 'aria-expanded') === 'false', `${page.name} mobile menu must start collapsed`);
  assert(getAttribute(menuButtons[0], 'aria-controls') === 'mobile-navigation', `${page.name} mobile button must control mobile-navigation`);
  assert(openingTags(page.html, 'nav').some((tag) => hasAttribute(tag, 'data-mobile-panel')), `${page.name} must contain mobile navigation`);
  assertVisibleIncludes(page.html, '商务合作', `${page.name} contact navigation`);
}
for (const [page, expectedHref] of [[indexPage, 'index.html'], [aboutPage, 'about.html']]) {
  const currentLinks = openingTags(page.html, 'a').filter((tag) => getAttribute(tag, 'aria-current') === 'page');
  assert(currentLinks.length >= 1, `${page.name} must identify the current page`);
  assert(currentLinks.every((tag) => getAttribute(tag, 'href') === expectedHref), `${page.name} aria-current links must target ${expectedHref}`);
}

// AS-9 through AS-12: the collaboration form exposes the agreed contract and real submit states.
const collaborationForm = pairedElements(indexPage.html, 'form').find((element) =>
  hasAttribute(elementOpeningTag(element), 'data-collaboration-form'),
);
assert(collaborationForm, 'AS-9 homepage contact section must contain the collaboration form');
const collaborationFields = [
  ['country', 'input', 'text', true, '100'],
  ['organizationType', 'select', null, true, null],
  ['givenName', 'input', 'text', true, '100'],
  ['familyName', 'input', 'text', true, '100'],
  ['workEmail', 'input', 'email', true, '254'],
  ['phone', 'input', 'tel', false, '50'],
  ['organizationName', 'input', 'text', false, '200'],
  ['organizationWebsite', 'input', 'url', false, '500'],
  ['requirements', 'textarea', null, true, '5000'],
];
for (const [name, tagName, type, required, maxLength] of collaborationFields) {
  const tags = openingTags(collaborationForm, tagName).filter((tag) => getAttribute(tag, 'name') === name);
  assert(tags.length === 1, `AS-9 collaboration form must contain exactly one ${tagName} name="${name}"`);
  if (type !== null) assert(getAttribute(tags[0], 'type') === type, `AS-9 ${name} must use type="${type}"`);
  assert(hasAttribute(tags[0], 'required') === required, `AS-9 ${name} required contract must be ${required}`);
  if (maxLength !== null) assert(getAttribute(tags[0], 'maxlength') === maxLength, `AS-9 ${name} must use maxlength="${maxLength}"`);
}
assert(hasAttribute(elementOpeningTag(collaborationForm), 'novalidate'), 'AS-9 form must use the scripted accessible validation flow');
assert(
  getAttribute(elementOpeningTag(collaborationForm), 'data-submit-url') === 'https://melsy-contact.blueshield-contact-worker.workers.dev/contact',
  'AS-10 form must target the dedicated Worker contact endpoint',
);
assert(
  /<script\b[^>]*src=["']contact-form\.mjs(?:\?[^"']*)?["'][^>]*type=["']module["']/i.test(indexPage.html),
  'AS-10 homepage must load the contact form coordinator as a module',
);
const honeypot = openingTags(collaborationForm, 'input').find((tag) => getAttribute(tag, 'name') === 'fax');
assert(honeypot && getAttribute(honeypot, 'tabindex') === '-1', 'AS-13 form must include a keyboard-inert honeypot');
const formStatus = openingTags(collaborationForm, 'p').find((tag) => hasAttribute(tag, 'data-form-status'));
assert(formStatus, 'AS-10 form must expose a status region');
assert(getAttribute(formStatus, 'role') === 'status', 'AS-10 form status must use role="status"');
assert(getAttribute(formStatus, 'aria-live') === 'polite', 'AS-10 form status must announce updates politely');
for (const snippet of [
  "form.addEventListener('submit'",
  'event.preventDefault()',
  'field.checkValidity()',
  "field.setAttribute('aria-invalid', 'true')",
  'invalidFields[0].focus()',
  "form.setAttribute('aria-busy', 'true')",
  "method: 'POST'",
  "'Content-Type': 'application/json'",
  '合作需求已提交',
  '你的填写内容已保留',
]) {
  assert(contactFormScript.includes(snippet), `AS-9/AS-10 collaboration form behavior must include: ${snippet}`);
}
for (const forbidden of ['在线提交接口尚未接入', '邮件已送达']) {
  assertVisibleExcludes(indexPage.html, forbidden, 'AS-10 contact form copy');
  assert(!contactFormScript.includes(forbidden), `AS-10 contact form script must not contain obsolete/misleading copy: ${forbidden}`);
}
for (const snippet of ["'Escape'", "getAttribute('aria-expanded') !== 'true'", "closest('a')", "addEventListener('resize'", "setAttribute('aria-expanded'"]) {
  assert(siteScript.includes(snippet), `AS-6 mobile navigation script must include: ${snippet}`);
}

// AS-7: video fallback/control contract plus actual browser-compatible encoding.
assertVideos(indexPage.html);
for (const snippet of ["video.addEventListener('error'", "media.classList.add('is-unavailable')", 'await video.play()', 'video.pause()']) {
  assert(siteScript.includes(snippet), `AS-7 video handling must include: ${snippet}`);
}

// AS-8: responsive, focus-visible, and reduced-motion behavior is present and does not hide core content by default.
for (const cssPattern of [
  [/:focus-visible\b/, 'visible keyboard focus'],
  [/@media\s*\(max-width:\s*900px\)/, 'tablet/mobile layout'],
  [/@media\s*\(max-width:\s*640px\)/, 'small-screen layout'],
  [/@media\s*\(prefers-reduced-motion:\s*reduce\)/, 'reduced-motion styles'],
]) {
  assert(cssPattern[0].test(styles), `AS-8 styles.css must include ${cssPattern[1]}`);
}
assert(siteScript.includes("matchMedia('(prefers-reduced-motion: reduce)')"), 'AS-8 JavaScript must observe reduced-motion preferences');
assert(siteScript.includes('for (const video of document.querySelectorAll(\'video\')) video.pause()'), 'AS-8 reduced motion must pause all product videos');

// Migration protection: the replaced homepage remains recoverable but is never served by V2 pages.
assert(existsSync(archiveIndexPath), 'old homepage index.html must remain archived under stale/old-homepage');
assert(existsSync(archiveLogoPath), 'old homepage logo.png must remain archived under stale/old-homepage');
assert(statSync(archiveLogoPath).isFile() && statSync(archiveLogoPath).size > 0, 'archived logo.png must be a non-empty file');
const archivedHtml = readUtf8(archiveIndexPath);
assertVisibleIncludes(archivedHtml, 'AI Agent', 'archived homepage identity');
assertVisibleIncludes(archivedHtml, '赋能实体世界', 'archived homepage identity');
assert(archivedHtml !== indexPage.html, 'archived homepage must remain distinct from the V2 homepage');

console.log('site smoke checks passed: public pages, AS-1..AS-13, media codecs, and archive migration protection');
