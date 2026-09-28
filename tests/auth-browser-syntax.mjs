// Run after next build. This checks a known Safari 15.5 startup blocker;
// it is not a substitute for testing Safari itself.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

const root = process.argv[2] || '.next/static';
const failures = [];
let scripts = 0;
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else if (entry.name.endsWith('.js')) {
      scripts++;
      const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const visit = node => {
        if (ts.isClassStaticBlockDeclaration(node)) failures.push(path);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
}
await inspect(root);
assert.ok(scripts > 0, 'No built browser scripts found');
assert.deepEqual([...new Set(failures)], [], 'Safari 15.5 cannot parse class static initialization blocks');
console.log(JSON.stringify({ scripts, classStaticBlocks: failures.length, realSafariTest: false }));
