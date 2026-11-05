#!/usr/bin/env node
// Offline, zero-dependency publishing helper. Research belongs to the host AI.
import { readFile, writeFile, mkdir, readdir, lstat, rename, unlink, rmdir, link } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const MARKER = '<!-- daily-briefing generated; schemaVersion=1 -->';
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const STATUSES = { verified: '已核验（输入标记）', partial: '部分核验', unverified: '未核验' };
const ROOT_KEYS = ['schemaVersion', 'cadence', 'editionDate', 'title', 'periodStart', 'periodEnd', 'verifiedThrough', 'timeZone', 'isDemo', 'items'];
const ITEM_KEYS = ['id', 'topic', 'title', 'eventDate', 'sourcePublishedAt', 'verifiedAt', 'summary', 'whyItMatters', 'editorialNote', 'verificationStatus', 'sources'];

function fail(message) { throw new Error(message); }

function objectWithKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(`${label}.${key} is required`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${label}.${key} is not supported`);
}

function textValue(value, label, limit = 5000) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) fail(`${label} must be a non-empty string (max ${limit} characters)`);
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value)) fail(`${label} contains a control character`);
  return value;
}

function calendarDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) fail(`${label} must be YYYY-MM-DD`);
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) fail(`${label} is not a valid calendar date`);
  return value;
}

function timestamp(value, label) {
  const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) fail(`${label} must be an RFC3339 timestamp with a timezone and seconds`);
  calendarDate(match[1], label);
  if (+match[2] > 23 || +match[3] > 59 || +match[4] > 59) fail(`${label} has an invalid clock time`);
  if (match[5] !== 'Z') {
    const [hours, minutes] = match[5].slice(1).split(':').map(Number);
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) fail(`${label} has an invalid timezone offset`);
  }
  if (!Number.isFinite(Date.parse(value))) fail(`${label} is not a valid timestamp`);
  return value;
}

function sourceURL(value, label) {
  textValue(value, label, 4000);
  if (/[\s\\]/u.test(value)) fail(`${label} must not contain whitespace or backslashes`);
  let url;
  try { url = new URL(value); } catch { fail(`${label} must be an absolute http/https URL`); }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) fail(`${label} must be an absolute http/https URL without credentials`);
  return url.href;
}

/** Validate and return a canonical, public-safe shape; unknown fields are rejected. */
export function validateEdition(input) {
  objectWithKeys(input, ROOT_KEYS, 'edition');
  if (input.schemaVersion !== 1) fail('edition.schemaVersion must be 1');
  if (!['daily', 'weekly'].includes(input.cadence)) fail('edition.cadence must be daily or weekly');
  const editionDate = calendarDate(input.editionDate, 'edition.editionDate');
  const periodStart = calendarDate(input.periodStart, 'edition.periodStart');
  const periodEnd = calendarDate(input.periodEnd, 'edition.periodEnd');
  if (periodStart > periodEnd || periodEnd > editionDate) fail('periodStart <= periodEnd <= editionDate is required');
  const verifiedThrough = timestamp(input.verifiedThrough, 'edition.verifiedThrough');
  const timeZone = textValue(input.timeZone, 'edition.timeZone', 100);
  try { new Intl.DateTimeFormat('en', { timeZone }).format(); } catch { fail('edition.timeZone must be a supported IANA timezone'); }
  if (typeof input.isDemo !== 'boolean') fail('edition.isDemo must be boolean');
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 200) fail('edition.items must contain 1 to 200 items');
  const ids = new Set();
  const items = input.items.map((item, index) => {
    const label = `edition.items[${index}]`;
    objectWithKeys(item, ITEM_KEYS, label);
    if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,79}$/u.test(item.id) || ids.has(item.id)) fail(`${label}.id must be a unique lowercase safe identifier`);
    ids.add(item.id);
    const sourcePublishedAt = item.sourcePublishedAt === null ? null : timestamp(item.sourcePublishedAt, `${label}.sourcePublishedAt`);
    const verifiedAt = item.verifiedAt === null ? null : timestamp(item.verifiedAt, `${label}.verifiedAt`);
    if (typeof item.verificationStatus !== 'string' || !Object.hasOwn(STATUSES, item.verificationStatus)) fail(`${label}.verificationStatus must be verified, partial, or unverified`);
    if (verifiedAt === null && item.verificationStatus !== 'unverified') fail(`${label}.verifiedAt may be null only for unverified items`);
    if ((sourcePublishedAt !== null && Date.parse(sourcePublishedAt) > Date.parse(verifiedThrough)) || (verifiedAt !== null && ((sourcePublishedAt !== null && Date.parse(sourcePublishedAt) > Date.parse(verifiedAt)) || Date.parse(verifiedAt) > Date.parse(verifiedThrough)))) fail(`${label} requires known sourcePublishedAt <= verifiedAt <= verifiedThrough`);
    if (!Array.isArray(item.sources) || item.sources.length < 1 || item.sources.length > 30) fail(`${label}.sources must contain 1 to 30 sources`);
    return {
      id: item.id,
      topic: textValue(item.topic, `${label}.topic`, 100),
      title: textValue(item.title, `${label}.title`, 250),
      eventDate: item.eventDate === null ? null : calendarDate(item.eventDate, `${label}.eventDate`),
      sourcePublishedAt,
      verifiedAt,
      summary: textValue(item.summary, `${label}.summary`),
      whyItMatters: textValue(item.whyItMatters, `${label}.whyItMatters`),
      editorialNote: textValue(item.editorialNote, `${label}.editorialNote`),
      verificationStatus: item.verificationStatus,
      sources: item.sources.map((source, sourceIndex) => {
        const sourceLabel = `${label}.sources[${sourceIndex}]`;
        objectWithKeys(source, ['title', 'url'], sourceLabel);
        return { title: textValue(source.title, `${sourceLabel}.title`, 250), url: sourceURL(source.url, `${sourceLabel}.url`) };
      }),
    };
  });
  const result = { schemaVersion: 1, cadence: input.cadence, editionDate, title: textValue(input.title, 'edition.title', 250), periodStart, periodEnd, verifiedThrough, timeZone, isDemo: input.isDemo, items };
  if (Buffer.byteLength(`${JSON.stringify(result, null, 2)}\n`, 'utf8') > MAX_INPUT_BYTES) fail('The edition exceeds the 2 MiB input limit');
  return result;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function escapeMarkdown(value) {
  return String(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/[\\`*_{}\[\]()#+\-.!|]/gu, '\\$&').replace(/\r?\n/gu, '<br>');
}

const notice = edition => edition.isDemo
  ? '虚构演示：所有事件、产品与判断均为原创虚构，仅演示文件输出，不代表真实新闻。'
  : '内容与核验状态来自输入；本工具不联网采集，不代替宿主 AI 研究或人工核验。';
const cadenceLabel = edition => edition.cadence === 'daily' ? '日阅读档' : '周阅读档';
const knownDate = value => value === null ? '未知（未提供）' : value;

function markdown(edition) {
  const md = escapeMarkdown;
  const lines = [MARKER, `# ${md(edition.title)}`, '', `> ${notice(edition)}`, '', `- 期号日期：${edition.editionDate} · ${cadenceLabel(edition)}`, `- 覆盖范围：${edition.periodStart} — ${edition.periodEnd}`, `- 核验截止：${md(edition.verifiedThrough)} · 显示时区：${md(edition.timeZone)}`, '', '事件日期、来源发布时间和核验时间分别保留；“已核验”仅复述输入标记。', ''];
  for (const item of edition.items) {
    lines.push(`## ${md(item.topic)} · ${md(item.title)}`, '', `事件日期：${md(knownDate(item.eventDate))}  `, `来源发布时间：${md(knownDate(item.sourcePublishedAt))}  `, `逐条核验时间：${md(knownDate(item.verifiedAt))}  `, `核验状态：${STATUSES[item.verificationStatus]}`, '', '| 事实摘要（来源所述） | 编辑判断 |', '| --- | --- |', `| ${md(item.summary)} | 为什么重要：${md(item.whyItMatters)}<br><br>编辑备注／缺口：${md(item.editorialNote)} |`, '', '来源：', '');
    for (const source of item.sources) {
      // Angle-delimited, encoded destinations cannot break out of a Markdown link.
      const destination = source.url.replace(/[<>"']/gu, char => encodeURIComponent(char).replace(/'/gu, '%27'));
      lines.push(`- [${md(source.title)}](<${destination}>)`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function page(title, body) {
  return `<!doctype html>\n${MARKER}\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHTML(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:1040px;margin:auto;padding:32px 20px;background:#f5f3ec;color:#242c32;line-height:1.75}a{color:#155a83;overflow-wrap:anywhere}header,article{background:white;border:1px solid #dadbd5;border-radius:14px;padding:24px;margin-bottom:22px}h1{line-height:1.25}h2{line-height:1.4}p,td,dd{overflow-wrap:anywhere;white-space:pre-wrap}.notice{border-left:4px solid #a35a16;padding:12px;background:#fff4df}dl{display:grid;grid-template-columns:9em 1fr;gap:4px 12px}dd{margin:0}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{padding:14px;border:1px solid #ddd;text-align:left;vertical-align:top}th{background:#f0f4f4}small{color:#58636b}@media(max-width:620px){body{padding:16px 10px}header,article{padding:16px}dl{grid-template-columns:1fr}dd{margin-bottom:8px}th,td{padding:9px;font-size:.94rem}}</style></head><body>${body}</body></html>\n`;
}

function html(edition) {
  const h = escapeHTML;
  const articles = edition.items.map(item => `<article id="${item.id}"><small>${h(item.topic)} · ${STATUSES[item.verificationStatus]}</small><h2>${h(item.title)}</h2><dl><dt>事件日期</dt><dd>${h(knownDate(item.eventDate))}</dd><dt>来源发布时间</dt><dd>${h(knownDate(item.sourcePublishedAt))}</dd><dt>逐条核验时间</dt><dd>${h(knownDate(item.verifiedAt))}</dd></dl><table><thead><tr><th>事实摘要（来源所述）</th><th>编辑判断</th></tr></thead><tbody><tr><td>${h(item.summary)}</td><td><strong>为什么重要</strong><p>${h(item.whyItMatters)}</p><strong>编辑备注／缺口</strong><p>${h(item.editorialNote)}</p></td></tr></tbody></table><h3>来源</h3><ul>${item.sources.map(source => `<li><a href="${h(source.url)}" target="_blank" rel="noopener noreferrer">${h(source.title)}</a></li>`).join('')}</ul></article>`).join('\n');
  return page(edition.title, `<nav><a href="index.html">历史目录</a> · <a href="${edition.editionDate}.md">Markdown</a> · <a href="${edition.editionDate}.json">JSON</a></nav><header><p>${cadenceLabel(edition)} · ${edition.editionDate}</p><h1>${h(edition.title)}</h1><p class="notice">${notice(edition)}</p><dl><dt>覆盖范围</dt><dd>${edition.periodStart} — ${edition.periodEnd}</dd><dt>核验截止</dt><dd>${h(edition.verifiedThrough)}</dd><dt>显示时区</dt><dd>${h(edition.timeZone)}</dd></dl><small>时间戳保留输入时区偏移，不自动换算。“已核验”仅复述输入标记。</small></header>${articles}`);
}

function indexHTML(editions) {
  return page('阅读档案', `<header><h1>阅读档案</h1><p>离线阅读页 · <a href="latest.html">最新一期</a> · <a href="latest.md">最新 Markdown</a></p><p>日／周内容由宿主 AI 研究后导入；这里没有网络采集器、模型调用或定时器。</p></header><section><ul>${editions.map(edition => `<li><a href="${edition.editionDate}.html">${edition.editionDate} · ${escapeHTML(edition.title)}</a> · ${cadenceLabel(edition)}${edition.isDemo ? ' · 虚构演示' : ''}<br><small>覆盖 ${edition.periodStart} — ${edition.periodEnd} · 核验截止 ${escapeHTML(edition.verifiedThrough)}</small></li>`).join('\n')}</ul></section>`);
}

const jsonText = value => `${JSON.stringify(value, null, 2)}\n`;

async function regularText(file, maxBytes = MAX_INPUT_BYTES * 16) {
  let stat;
  try { stat = await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`Refusing non-regular file: ${path.basename(file)}`);
  if (stat.size > maxBytes) fail(`File is too large: ${path.basename(file)}`);
  return readFile(file, 'utf8');
}

async function readEdition(file) {
  const raw = await regularText(file, MAX_INPUT_BYTES);
  if (raw === null) fail(`Input file does not exist: ${file}`);
  let value;
  try { value = JSON.parse(raw); } catch { fail(`Invalid JSON: ${path.basename(file)}`); }
  return validateEdition(value);
}

async function withDirectoryLock(directory, action) {
  const root = path.resolve(directory);
  await mkdir(root, { recursive: true });
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('The output directory must be a real directory, not a symlink');
  const lock = path.join(root, '.briefing.lock');
  try { await mkdir(lock); } catch (error) {
    if (error.code === 'EEXIST') fail('Directory is locked (.briefing.lock). If a previous process crashed, confirm it is stopped before removing that empty lock directory.');
    throw error;
  }
  try { return await action(root); } finally { await rmdir(lock); }
}

async function atomicWrite(root, name, content, exclusive = false) {
  // All filenames are internal literals or strictly validated calendar dates.
  const temporary = path.join(root, `.${name}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    if (exclusive) await link(temporary, path.join(root, name));
    else await rename(temporary, path.join(root, name));
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** Each file is replaced atomically. A whole edition is NOT a multi-file transaction. */
export async function renderEdition(input, directory) {
  const edition = validateEdition(input); // Validate completely before creating directories or locks.
  return withDirectoryLock(directory, async root => {
    const archives = new Map();
    for (const name of (await readdir(root)).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/u.test(name)).sort()) {
      const archived = await readEdition(path.join(root, name));
      if (`${archived.editionDate}.json` !== name) fail(`Archive date does not match filename: ${name}`);
      archives.set(archived.editionDate, archived);
    }
    const existingEdition = archives.get(edition.editionDate);
    if (existingEdition && jsonText(existingEdition) !== jsonText(edition)) fail(`Conflict: ${edition.editionDate} already contains a different edition. Use a separate output directory for a revision.`);
    archives.set(edition.editionDate, edition);
    const editions = [...archives.values()].sort((a, b) => b.editionDate.localeCompare(a.editionDate));
    const latest = editions[0];
    const plans = [
      { name: `${edition.editionDate}.md`, content: markdown(edition), immutable: true },
      { name: `${edition.editionDate}.html`, content: html(edition), immutable: true },
      { name: `${edition.editionDate}.json`, content: jsonText(edition), immutable: true },
      { name: 'latest.md', content: markdown(latest), immutable: false },
      { name: 'latest.html', content: html(latest), immutable: false },
      { name: 'index.html', content: indexHTML(editions), immutable: false },
    ];
    const writes = [];
    // Check all collisions before changing any publication file.
    for (const plan of plans) {
      const current = await regularText(path.join(root, plan.name));
      if (current === plan.content) continue;
      if (current !== null && plan.immutable) {
        // Key order/formatting differences in the canonical JSON are not content changes.
        if (plan.name.endsWith('.json') && existingEdition) continue;
        fail(`Conflict: refusing to overwrite existing archive file ${plan.name}`);
      }
      if (current !== null && !current.includes(MARKER)) fail(`Conflict: ${plan.name} was not generated by this tool`);
      writes.push(plan);
    }
    for (const plan of writes) await atomicWrite(root, plan.name, plan.content);
    return { status: writes.length ? 'rendered' : 'unchanged', editionDate: edition.editionDate, latestDate: latest.editionDate, output: root, filesWritten: writes.map(plan => plan.name) };
  });
}

export async function initWorkspace(directory) {
  const profileText = await readFile(new URL('../assets/example.profile.json', import.meta.url), 'utf8');
  return withDirectoryLock(directory, async root => {
    const inputDir = path.join(root, 'input');
    await mkdir(inputDir, { recursive: true });
    const inputStat = await lstat(inputDir);
    if (!inputStat.isDirectory() || inputStat.isSymbolicLink()) fail('input must be a real directory');
    const existing = await regularText(path.join(root, 'profile.json'));
    let profileCreated = false;
    if (existing === null) {
      // Hard-link the temporary file: the destination can never overwrite a racing file.
      try { await atomicWrite(root, 'profile.json', profileText, true); profileCreated = true; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    return { status: 'initialized', workspace: root, profileCreated, inputDirectory: inputDir };
  });
}

export async function runDemo(directory) {
  const daily = await readEdition(fileURLToPath(new URL('../assets/example.edition.json', import.meta.url)));
  const weekly = validateEdition({ ...daily, cadence: 'weekly', editionDate: '2030-01-13', title: '虚构演示周报：纸灯图书馆的一周', periodStart: '2030-01-07', periodEnd: '2030-01-13', verifiedThrough: '2030-01-13T18:00:00Z', items: daily.items.map(item => ({ ...item, editorialNote: `虚构周复盘：保留本周样例与原始缺口。${item.editorialNote}` })) });
  const dailyResult = await renderEdition(daily, directory);
  const weeklyResult = await renderEdition(weekly, directory);
  return { status: 'demo', isDemo: true, output: path.resolve(directory), editions: [dailyResult, weeklyResult] };
}

const USAGE = `Offline daily-briefing (Node >=18, no dependencies)
  node briefing.mjs init --dir <workspace>
  node briefing.mjs demo --output <directory>
  node briefing.mjs render --input <edition.json> --output <directory>
This helper does not fetch news, call an LLM, or schedule tasks.
Same-date content conflicts are refused; use a separate directory for a revision.
`;

async function main(args) {
  if (!args.length || args.includes('--help') || args.includes('-h')) { process.stdout.write(USAGE); return; }
  const [command, ...rest] = args;
  const allowed = { init: ['--dir'], demo: ['--output'], render: ['--input', '--output'] }[command];
  if (!allowed) fail(`Unknown command: ${command}`);
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (!allowed.includes(flag) || Object.hasOwn(options, flag) || !value || value.startsWith('--')) fail(`Invalid or repeated option: ${flag}`);
    options[flag] = value;
  }
  for (const flag of allowed) if (!options[flag]) fail(`Missing required option: ${flag}`);
  let result;
  if (command === 'init') result = await initWorkspace(options['--dir']);
  else if (command === 'demo') result = await runDemo(options['--output']);
  else result = await renderEdition(await readEdition(path.resolve(options['--input'])), options['--output']);
  process.stdout.write(jsonText(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`Error: ${error.message}\n`); process.exitCode = 1; });
}
