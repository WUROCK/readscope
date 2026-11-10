const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function isolatedLog(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'readscope-log-'));
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return path.join(directory, 'run.log');
}

test('关闭输出管道不会中断桌面日志或触发未捕获异常', (t) => {
  const file = isolatedLog(t);
  const module = path.resolve(__dirname, '../logging.cjs');
  const code = `require(process.argv[1]).installFileLogging(process.argv[2]);
    process.stdout.emit('error',Object.assign(new Error('closed'),{code:'EPIPE'}));
    console.log('still running');`;
  const child = spawnSync(process.execPath, ['-e', code, module, file], { windowsHide: true });
  assert.equal(child.status, 0, child.stderr.toString());
  assert.match(fs.readFileSync(file, 'utf8'), /still running/);
});

test('日志处理不会掩盖真正的未捕获程序异常', (t) => {
  const file = isolatedLog(t);
  const module = path.resolve(__dirname, '../logging.cjs');
  const child = spawnSync(process.execPath, ['-e', `require(process.argv[1]).installFileLogging(process.argv[2]);throw new Error('real application failure');`, module, file], { windowsHide: true });
  assert.equal(child.status, 1);
  assert.match(child.stderr.toString(), /real application failure/);
});
