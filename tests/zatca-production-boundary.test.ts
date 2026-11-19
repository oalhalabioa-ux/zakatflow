import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

function sourceFiles(directory: string): string[] {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) ? [path] : [];
  });
}

describe('ZATCA synthetic compatibility profile boundary', () => {
  it('keeps the SDK 3.4.5 diagnostic signer out of application and backend source', () => {
    // A sandbox PASS does not approve this profile for taxpayer invoices.
    // Scan libraries and services too: an indirect route import is equally unsafe.
    const violations = ['app', 'components', 'lib', 'services'].flatMap(sourceFiles)
      .filter(path => /zatca-sdk345-qa-profile|prepareZatcaSdk345QaDocument|simulation-procedural-document|prepareSimulationProceduralDocument|procedural-simplified-compliance-qa|createProceduralSimplifiedComplianceQa|final-simulation-csid-qa|createFinalSimulationCsidQa|simulation-certificate-discovery/.test(readFileSync(resolve(root, path), 'utf8')));
    expect(violations).toEqual([]);
  });
});
