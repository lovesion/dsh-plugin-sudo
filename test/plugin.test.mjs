import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as plugin from '../index.mjs';

test('exports plugin metadata', () => {
  assert.equal(plugin.name, 'tool-sudo');
  assert.deepEqual(plugin.inject, ['tools', 'userQuestions']);
  assert.equal(typeof plugin.apply, 'function');
});

test('apply registers sudo_run with the documented schema', () => {
  const registered = [];
  const ctx = { tools: { register(tool) { registered.push(tool); } } };

  plugin.apply(ctx);

  assert.equal(registered.length, 1);
  const tool = registered[0];
  assert.equal(tool.name, 'sudo_run');
  assert.deepEqual(tool.parameters.required, ['description', 'command']);
  assert.equal(tool.parameters.properties.command.type, 'string');
  assert.equal(tool.parameters.properties.timeoutMs.type, 'number');
  assert.equal(tool.parameters.additionalProperties, false);
  assert.equal(tool.output.schema.properties.exitCode.type, 'number');
});

test('output render appends the exit code', () => {
  const registered = [];
  plugin.apply({ tools: { register(tool) { registered.push(tool); } } });
  const render = registered[0].output.render;

  const ok = render({}, { exitCode: 0, stdout: 'hello', stderr: '' });
  assert.equal(ok[0].type, 'text');
  assert.equal(ok[0].text, 'hello\n[exit code: 0]');

  const failed = render({}, { exitCode: 2, stdout: '', stderr: 'boom' });
  assert.equal(failed[0].text, 'boom\n[exit code: 2]');
});
