/**
 * M7-140, the engine-independent half of the proof (ADR-0210; docs/ARCHITEKTUR.md "Determinismus über JS-Engines"): the
 * portable functions of `src/engine/portableMath.ts` are pure IEEE-754 arithmetic. IEEE 754 fixes the result of `+`, `−`,
 * `×`, `÷` and `√` to the bit (correctly rounded), ECMAScript forbids fusing or widening them (every operation rounds to a
 * double), and `Math.abs`, `Math.round`, `Math.trunc`, `Math.floor`, the bit operators and the reads and writes of a
 * `DataView`/`Float64Array` are exact – so every engine that implements ECMAScript gives the same bits, Firefox
 * (SpiderMonkey) and WebKit (JavaScriptCore) as much as Node and Chromium (V8). The E2E `determinismus.spec.ts` checks it
 * where those browsers are installed; this test checks the premise everywhere: the module's code (not its comments) calls
 * no other `Math` function, uses no `**`, reaches no global but the exact ones, and calls nothing outside itself.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url)).replace(/[\\/]$/, '');
const MODULE = 'src/engine/portableMath.ts';

/** `Math` functions IEEE 754 or ECMAScript fix to the bit (correctly rounded root, exact rounding and absolute value). */
const EXACT_MATH = new Set(['abs', 'sqrt', 'round', 'trunc', 'floor']);
/** `Number` predicates the specification defines exactly (no rounding: a double is NaN or whole, or it is not). */
const EXACT_NUMBER = new Set(['isNaN', 'isInteger', 'isFinite', 'isSafeInteger']);
/**
 * Globals the module may name: `Math` (only `EXACT_MATH`), `Number` (only `EXACT_NUMBER`), the typed views of its bit
 * register, the error of a range.
 */
const ALLOWED_GLOBALS = new Set(['Math', 'Number', 'Infinity', 'NaN', 'Float64Array', 'ArrayBuffer', 'DataView', 'RangeError']);
/** Exact `DataView` accessors of the bit register (`bits`): whole words in, whole words or the same double out. */
const BIT_ACCESSORS = new Set(['getFloat64', 'setFloat64', 'getInt32', 'setInt32', 'getUint32', 'setUint32']);

interface Inventory {
  /** `Math.<name>` member names read in code. */
  readonly math: Set<string>;
  /** `Number.<name>` member names read in code. */
  readonly number: Set<string>;
  /** Free identifiers (not declared in the module) in value positions. */
  readonly globals: Set<string>;
  /** Callees: `name` for a call of an identifier, `object.member` for a method call. */
  readonly callees: Set<string>;
  /** Functions the module declares. */
  readonly functions: Set<string>;
  /** Operator tokens of binary and compound assignment expressions. */
  readonly operators: Set<string>;
}

function inventory(source: string): Inventory {
  const file = ts.createSourceFile(MODULE, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const declared = new Set<string>();
  const functions = new Set<string>();
  const math = new Set<string>();
  const number = new Set<string>();
  const callees = new Set<string>();
  const operators = new Set<string>();
  const used: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      functions.add(node.name.text);
      declared.add(node.name.text);
    }
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) declared.add(node.name.text);
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Math') math.add(node.name.text);
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Number') number.add(node.name.text);
    if (ts.isBinaryExpression(node)) operators.add(ts.tokenToString(node.operatorToken.kind) ?? String(node.operatorToken.kind));
    if (ts.isCallExpression(node)) {
      const c = node.expression;
      if (ts.isIdentifier(c)) callees.add(c.text);
      else if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression)) callees.add(`${c.expression.text}.${c.name.text}`);
      else callees.add(`<${ts.SyntaxKind[c.kind]}>`);
    }
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      // Member names, declaration names, type positions, import/export specifiers and property keys are no value reads.
      const member = ts.isPropertyAccessExpression(parent) && parent.name === node;
      const typePosition = ts.isTypeReferenceNode(parent) || ts.isExpressionWithTypeArguments(parent) || ts.isTypeQueryNode(parent);
      const key = (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === node;
      const declaration = (ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isParameter(parent)) && parent.name === node;
      if (!member && !typePosition && !key && !declaration && !ts.isExportSpecifier(parent) && !ts.isImportSpecifier(parent)) used.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const globals = new Set(used.map((id) => id.text).filter((name) => !declared.has(name)));
  return { math, number, globals, callees, functions, operators };
}

describe('Portable Mathematik ist reine IEEE-754-Arithmetik (M7-140: dieselben Bits in jeder Engine)', () => {
  const source = readFileSync(join(ROOT, MODULE), 'utf8');
  const inv = inventory(source);

  it('ruft nur die exakten Math-Funktionen (abs, sqrt, round, trunc, floor) – keine angenäherte, kein **', () => {
    expect([...inv.math].filter((name) => !EXACT_MATH.has(name))).toEqual([]);
    // The module does use the exact ones (the inventory reads real code, not an empty set).
    expect([...inv.math].sort()).toEqual(['abs', 'round', 'sqrt', 'trunc']);
    expect(inv.operators.has('**')).toBe(false);
    expect(inv.operators.has('**=')).toBe(false);
    // The four basic operations and the bit operators are what it computes with.
    for (const op of ['+', '-', '*', '/', '&', '|', '>>', '>>>']) expect(inv.operators.has(op), op).toBe(true);
  });

  it('erreicht keine globale Funktion außer den exakten (kein parseFloat, Number.parseFloat, Intl, Date …)', () => {
    expect([...inv.globals].filter((name) => !ALLOWED_GLOBALS.has(name)).sort()).toEqual([]);
    expect([...inv.number].filter((name) => !EXACT_NUMBER.has(name))).toEqual([]);
  });

  it('ruft nur eigene Funktionen, die exakten Math-Funktionen und die Bit-Zugriffe seines Registers', () => {
    const foreign = [...inv.callees].filter((callee) => {
      if (inv.functions.has(callee)) return false;
      const [object, member] = callee.split('.');
      if (object === 'Math' && member !== undefined) return !EXACT_MATH.has(member);
      if (object === 'Number' && member !== undefined) return !EXACT_NUMBER.has(member);
      if (object === 'bits' && member !== undefined) return !BIT_ACCESSORS.has(member);
      return true;
    });
    expect(foreign).toEqual([]);
    // Every portable function of M7-76 and M7-139 is in the inventory (so the checks above cover them).
    for (const name of ['psin', 'pcos', 'sinCosIn', 'plog', 'pexp', 'pexp2', 'ppow', 'atan2In', 'patan2', 'tanIn', 'ptan', 'asinIn', 'pasin', 'hypotIn', 'phypot']) expect(inv.functions.has(name), name).toBe(true);
  });

  it('die Prüfung greift: eine Mutante mit Math.atan2, Math.exp, **, Number.parseFloat oder parseFloat fällt auf', () => {
    const mutants: ReadonlyArray<readonly [string, (i: Inventory) => boolean]> = [
      ['export function f(y: number, x: number): number {\n  return Math.atan2(y, x);\n}\n', (i) => i.math.has('atan2')],
      ['export function f(x: number): number {\n  return Math.exp(x);\n}\n', (i) => i.math.has('exp')],
      ['export function f(x: number): number {\n  return x ** 0.5;\n}\n', (i) => i.operators.has('**')],
      ['export function f(x: string): number {\n  return Number.parseFloat(x);\n}\n', (i) => i.number.has('parseFloat')],
      ['export function f(x: string): number {\n  return parseFloat(x);\n}\n', (i) => i.globals.has('parseFloat')],
    ];
    for (const [code, caught] of mutants) expect(caught(inventory(`${source}\n${code}`)), code).toBe(true);
  });
});
