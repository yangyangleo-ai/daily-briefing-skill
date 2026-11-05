import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderEdition, validateEdition } from '../skills/daily-briefing/scripts/briefing.mjs';

const cli = fileURLToPath(new URL('../skills/daily-briefing/scripts/briefing.mjs', import.meta.url));
const sample = JSON.parse(await readFile(new URL('../skills/daily-briefing/assets/example.edition.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(sample);
async function temporary(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'daily-briefing-'));
  t.after(async () => {
    const target = path.resolve(dir);
    if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith('daily-briefing-')) throw new Error('Refusing cleanup outside the test temporary directory');
    await rm(target, { recursive: true, force: true });
  });
  return dir;
}
function run(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error);
  return result;
}

test('demo CLI creates clearly fictional daily and weekly offline archives', async t => {
  const dir = await temporary(t);
  const output = path.join(dir, 'demo');
  const result = run('demo', '--output', output);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).isDemo, true);
  const names = await readdir(output);
  assert.deepEqual(names.sort(), ['2030-01-08.html', '2030-01-08.json', '2030-01-08.md', '2030-01-13.html', '2030-01-13.json', '2030-01-13.md', 'index.html', 'latest.html', 'latest.md'].sort());
  assert.match(await readFile(path.join(output, 'latest.html'), 'utf8'), /虚构演示周报/);
  assert.match(await readFile(path.join(output, '2030-01-08.md'), 'utf8'), /事实摘要（来源所述） \| 编辑判断/);
});

test('same edition is idempotent; importing older history never rolls latest backward', async t => {
  const dir = await temporary(t);
  const newer = { ...clone(), editionDate: '2030-01-10', title: '虚构较新一期' };
  await renderEdition(newer, dir);
  const latestBefore = await readFile(path.join(dir, 'latest.html'), 'utf8');
  const second = await renderEdition(newer, dir);
  assert.equal(second.status, 'unchanged');
  assert.deepEqual(second.filesWritten, []);
  const old = await renderEdition(clone(), dir);
  assert.equal(old.latestDate, newer.editionDate);
  assert.equal(await readFile(path.join(dir, 'latest.html'), 'utf8'), latestBefore);
  assert.match(await readFile(path.join(dir, 'index.html'), 'utf8'), /2030-01-08\.html/);
});

test('same date with changed content refuses and preserves all publication files', async t => {
  const dir = await temporary(t);
  await renderEdition(clone(), dir);
  const before = new Map(await Promise.all((await readdir(dir)).map(async name => [name, await readFile(path.join(dir, name), 'utf8')])));
  const changed = clone();
  changed.items[0].summary = '另一份虚构内容';
  await assert.rejects(renderEdition(changed, dir), /Conflict/);
  assert.deepEqual((await readdir(dir)).sort(), [...before.keys()].sort());
  for (const [name, content] of before) assert.equal(await readFile(path.join(dir, name), 'utf8'), content);
});

test('invalid calendar dates, time ordering and unsafe URLs fail before output exists', async t => {
  const dir = await temporary(t);
  const cases = [
    value => { value.editionDate = '2030-02-30'; },
    value => { value.periodStart = '../../outside'; },
    value => { value.items[0].eventDate = '2030-02-29'; },
    value => { value.items[0].sourcePublishedAt = '2030-02-30T10:00:00Z'; },
    value => { value.verifiedThrough = '2030-01-08T25:00:00Z'; },
    value => { value.items[0].verifiedAt = '2030-01-09T17:00:00Z'; },
    value => { value.timeZone = 'not/a/timezone'; },
    value => { value.items[0].sources[0].url = 'javascript:alert(1)'; },
    value => { value.items[0].sources[0].url = 'file:///private.txt'; },
    value => { value.items[0].sources[0].url = 'data:text/html,hello'; },
    value => { value.items[0].sources[0].url = 'https://user:password@example.com/'; },
    value => { value.items[0].sources[0].url = 'https://example.com/\nunsafe'; },
  ];
  for (let index = 0; index < cases.length; index++) {
    const value = clone();
    cases[index](value);
    const output = path.join(dir, `bad-${index}`);
    await assert.rejects(renderEdition(value, output));
    await assert.rejects(readdir(output), { code: 'ENOENT' });
  }
  const validLeapYear = clone();
  validLeapYear.items[0].eventDate = '2028-02-29';
  assert.equal(validateEdition(validLeapYear).items[0].eventDate, '2028-02-29');
});

test('HTML and Markdown text are escaped, including titles, links and table cells', async t => {
  const dir = await temporary(t);
  const value = clone();
  value.title = '<script>alert("title")</script> & [x](javascript:evil)';
  value.items[0].summary = '<img src=x onerror=alert(1)> | **not bold**\n# not a heading';
  value.items[0].sources[0] = { title: '"><svg onload=alert(1)> [link]', url: 'https://example.com/path?x="quoted"&y=value' };
  Object.assign(value.items[1], { eventDate: null, sourcePublishedAt: null, verifiedAt: null, verificationStatus: 'unverified' });
  await renderEdition(value, dir);
  const html = await readFile(path.join(dir, '2030-01-08.html'), 'utf8');
  const md = await readFile(path.join(dir, '2030-01-08.md'), 'utf8');
  assert.doesNotMatch(html, /<script>|<img |<svg /);
  assert.match(html, /&lt;script&gt;alert\(&quot;title&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(md, /\\\| \\\*\\\*not bold\\\*\\\*<br>\\# not a heading/);
  assert.doesNotMatch(md, /<script>|<img |<svg /);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /未知（未提供）/);
  assert.match(md, /来源发布时间：未知（未提供）/);
});

test('init preserves existing profile; render CLI rejects invalid JSON', async t => {
  const dir = await temporary(t);
  const workspace = path.join(dir, 'workspace');
  let result = run('init', '--dir', workspace);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).profileCreated, true);
  const custom = '{"keep":"my existing preferences"}\n';
  await writeFile(path.join(workspace, 'profile.json'), custom);
  result = run('init', '--dir', workspace);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).profileCreated, false);
  assert.equal(await readFile(path.join(workspace, 'profile.json'), 'utf8'), custom);
  assert.deepEqual(await readdir(path.join(workspace, 'input')), []);
  const badInput = path.join(dir, 'bad.json');
  await writeFile(badInput, '{bad json');
  const output = path.join(dir, 'bad-output');
  result = run('render', '--input', badInput, '--output', output);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid JSON/);
  await assert.rejects(readdir(output), { code: 'ENOENT' });
});
