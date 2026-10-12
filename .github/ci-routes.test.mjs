import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suites } from './ci-routes.mjs';

test('routes each port, shared inputs, and main pushes', () => {
    const all = { typescript: true, swift: true, kotlin: true };
    assert.deepEqual(suites(['kotlin/src/main/kotlin/Time.kt']), { typescript: false, swift: false, kotlin: true });
    assert.deepEqual(suites(['swift/Tests/TimeTests.swift']), { typescript: false, swift: true, kotlin: false });
    assert.deepEqual(suites(['typescript/test/time.test.ts']), { typescript: true, swift: false, kotlin: false });
    for (const path of ['fixtures/parity/cycles.json','typescript/test/suncalc-2.1.1.json','typescript/src/events.ts','.github/workflows/ci.yml','.github/ci-routes.test.mjs','README.md','typescript/package.json','mise.toml','docs/CONTRACT.md']) assert.deepEqual(suites([path]), all, path);
    assert.deepEqual(suites(['benchmarks/cases.json']), { typescript: true, swift: true, kotlin: false });
    assert.deepEqual(suites(['docs/SCOPE.md']), { typescript: false, swift: false, kotlin: false });
    assert.deepEqual(suites([], 'push'), all);
});
