import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function suites(paths, event = 'pull_request') {
    const result = { typescript: false, swift: false, kotlin: false };
    for (const path of paths) {
        if (event !== 'pull_request' || /^(fixtures\/|typescript\/src\/|typescript\/test\/(suncalc-2\.1\.1|migration-references)\.json$|\.github\/(workflows\/|scripts\/|mise\.toml$|ci-routes)|typescript\/package(-lock)?\.json$|Package\.swift$|mise\.toml$|README\.md$|LICENSE$|NOTICE$|docs\/(CONTRACT|migrating-from-.*)\.md$)/.test(path)) {
            return { typescript: true, swift: true, kotlin: true };
        }
        if (path.startsWith('typescript/')) result.typescript = true;
        if (path.startsWith('swift/')) result.swift = true;
        if (path.startsWith('kotlin/')) result.kotlin = true;
        if (path.startsWith('benchmarks/')) result.typescript = result.swift = true;
    }
    if (event !== 'pull_request') return { typescript: true, swift: true, kotlin: true };
    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const paths = process.env.GITHUB_EVENT_NAME === 'pull_request'
        ? execFileSync('git', ['diff', '--name-only', `${process.env.BASE}...HEAD`], { encoding: 'utf8' }).trim().split('\n') : [];
    const result = suites(paths, process.env.GITHUB_EVENT_NAME);
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key,value]) => `${key}=${value}\n`).join(''));
}
