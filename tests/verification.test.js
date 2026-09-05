import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../scripts/verify-changes.mjs';

test('documentation does not build, launch browsers or publish', () => {
  const plan = classify(['README.md', 'docs/USAGE.md', 'dist/destined-journey-assistant.js']);
  for (const key of ['build', 'full', 'python', 'ui', 'assistant', 'themes', 'settings']) assert.equal(plan[key], false);
});
test('summary, styles, preset behavior and declarations choose their related checks', () => {
  const summary = classify(['src/summary/service.js']);
  assert(summary.build && summary.assistant && !summary.ui && !summary.themes);
  const styles = classify(['src/ui/styles.js']);
  assert(styles.themes && styles.settings && styles.assistant && !styles.ui);
  const preset = classify(['src/preset/connections.js']);
  assert(preset.ui && preset.settings && !preset.themes);
  const types = classify(['@types/function/generate.d.ts']);
  assert(types.python && !types.build);
  const mixed = classify(['src/summary/service.js', 'src/preset/connections.js']);
  assert(mixed.assistant && mixed.ui && mixed.settings);
});
test('shared state, tests, version files, build system and unknown paths require full verification', () => {
  for (const files of [null, ['src/platform/store.js'], ['src/preset/definitions.js'], ['package.json'], ['pnpm-lock.yaml'], ['tests/ui/test-ui.cjs'], ['new.file']]) {
    const plan = classify(files);
    assert(plan.full && plan.build && plan.ui && plan.assistant && plan.themes && plan.settings);
    assert.equal(plan.matrix.os.length, 2);
  }
});
