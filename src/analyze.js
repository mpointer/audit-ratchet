import ts from 'typescript';

/**
 * Analyze one module's text for exported mutation handlers and decide,
 * per handler, whether it reaches an audit sink with a namespaced action.
 *
 * The invariant, stated once: an exported handler named in `handlers`
 * passes when BOTH hold:
 *   (a) it reaches a sink: a call to a name in `sinks`, a call to a name
 *       imported from a module in `sinkModules`, or `x.insert(<table>)`
 *       for a table in `tableInserts`; following same-file helpers; and
 *   (b) either the sink namespaces the action itself (a name in
 *       `namespacingSinks`, or any sinkModules export not listed in
 *       `callerSuppliedAction`), or an action string opening with one of
 *       `actionPrefixes` (a literal, or a template opening with a name in
 *       `prefixConstants`) is reachable from the handler.
 *
 * A block comment containing `allowMarker`, inside the handler or in its
 * leading comment, exempts it; the comment must also carry at least
 * `minJustificationChars` of prose or the exemption is unjustified.
 *
 * Deliberately loose in two ways, both inherited from production use:
 * sink names match by NAME whatever module they came from, and any
 * reachable prefixed literal satisfies (b). A false negative costs an
 * unaudited route that review can still catch; a false positive costs a
 * contributor an afternoon arguing with CI, which is how a check gets
 * deleted rather than fixed.
 *
 * @returns one entry per exported handler, exemptions included.
 */
export function analyzeSource(file, text, cfg) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const handlers = new Set(cfg.handlers);
  const sinks = new Set(cfg.sinks);
  const sinkModules = new Set(cfg.sinkModules);
  const callerSupplied = new Set(cfg.callerSuppliedAction);
  const namespacing = new Set(cfg.namespacingSinks);
  const tables = new Set(cfg.tableInserts);
  const prefixConstants = new Set(cfg.prefixConstants);

  const locals = new Map();
  const importedSinks = new Map();
  for (const st of source.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) locals.set(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer &&
            (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          locals.set(d.name.text, d.initializer);
        }
      }
    }
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      if (!sinkModules.has(st.moduleSpecifier.text)) continue;
      const bindings = st.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const el of bindings.elements) {
        const original = (el.propertyName ?? el.name).text;
        importedSinks.set(el.name.text, callerSupplied.has(original));
      }
    }
  }

  const isNamespacedAction = (node) => {
    if (ts.isStringLiteralLike(node)) return cfg.actionPrefixes.some((p) => node.text.startsWith(p));
    if (ts.isTemplateExpression(node)) {
      if (node.head.text !== '') return false;
      const first = node.templateSpans[0]?.expression;
      return !!first && ts.isIdentifier(first) && prefixConstants.has(first.text);
    }
    return false;
  };
  const isTableInsert = (call) => {
    const callee = call.expression;
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'insert') return false;
    const arg = call.arguments[0];
    return !!arg && tables.has(arg.getText(source));
  };

  function scan(node, seen, acc) {
    const visit = (n) => {
      if (ts.isCallExpression(n)) {
        const name = calleeName(n);
        if (sinks.has(name)) {
          acc.sink = true;
          if (namespacing.has(name)) acc.namespacingSink = true;
        }
        if (importedSinks.has(name)) {
          acc.sink = true;
          if (!importedSinks.get(name)) acc.namespacingSink = true;
        }
        if (isTableInsert(n)) acc.sink = true;
        if (locals.has(name) && !seen.has(name)) {
          seen.add(name);
          const target = locals.get(name);
          scan(target.body ?? target, seen, acc);
        }
      }
      if (isNamespacedAction(n)) acc.namespacedAction = true;
      ts.forEachChild(n, visit);
    };
    visit(node);
  }

  const exported = [];
  for (const st of source.statements) {
    const isExported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (isExported && ts.isFunctionDeclaration(st) && st.name && handlers.has(st.name.text)) {
      exported.push({ stmt: st, name: st.name, body: st.body });
    }
    if (isExported && ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && handlers.has(d.name.text) && d.initializer) {
          const target = ts.isIdentifier(d.initializer) ? locals.get(d.initializer.text) : null;
          exported.push({ stmt: st, name: d.name, body: target ? (target.body ?? target) : d.initializer });
        }
        if (ts.isObjectBindingPattern(d.name) || ts.isArrayBindingPattern(d.name)) {
          for (const el of d.name.elements) {
            if (ts.isBindingElement(el) && ts.isIdentifier(el.name) && handlers.has(el.name.text)) {
              exported.push({ stmt: st, name: el.name, body: null, unresolved: true });
            }
          }
        }
      }
    }
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        const exportedAs = el.name.text;
        if (!handlers.has(exportedAs)) continue;
        const localName = (el.propertyName ?? el.name).text;
        const target = locals.get(localName);
        exported.push({ stmt: st, name: el.name, body: target ? (target.body ?? target) : null, unresolved: !target });
      }
    }
  }

  const out = [];
  for (const { stmt, name, body, unresolved } of exported) {
    const method = name.text;
    const line = source.getLineAndCharacterOfPosition(name.getStart(source)).line + 1;
    const allow = blockComments(stmt, source).find((c) => c.includes(cfg.allowMarker));
    if (allow) {
      out.push({
        key: `${file}::${method}`, file, method, line,
        exempt: true, audited: true,
        justified: hasJustification(allow, cfg),
        reason: `exempted by ${cfg.allowMarker}`,
      });
      continue;
    }
    const acc = { sink: false, namespacingSink: false, namespacedAction: false };
    if (body) scan(body, new Set(), acc);
    const audited = !unresolved && acc.sink && (acc.namespacingSink || acc.namespacedAction);
    out.push({
      key: `${file}::${method}`, file, method, line, audited, exempt: false,
      reason: unresolved
        ? 'exported binding could not be resolved to a function in this file'
        : !acc.sink
          ? 'no audit write reachable from this handler'
          : `writes an audit row, but not under the ${cfg.actionPrefixes.join('/')} namespace`,
    });
  }
  return out;
}

function calleeName(call) {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return '';
}

/**
 * `export * from '<module>'` statements. They can re-export handlers that
 * analyzeSource cannot see, so check warns about them instead of passing
 * the module silently. `export * as ns` and `export type *` export no handler.
 */
export function starExports(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  return source.statements
    .filter((st) => ts.isExportDeclaration(st) && !st.exportClause && !st.isTypeOnly &&
      st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier))
    .map((st) => ({
      specifier: st.moduleSpecifier.text,
      line: source.getLineAndCharacterOfPosition(st.getStart(source)).line + 1,
    }));
}

/** Strip delimiters, JSDoc asterisks and the marker; what remains must be prose. */
export function hasJustification(comment, cfg) {
  // Index loops, not /\*+\/$/: that regex is quadratic on a long run of `*`,
  // and the comment comes from the change under review.
  let start = comment.startsWith('/*') ? 2 : 0;
  let end = comment.endsWith('*/') && comment.length - 2 >= start ? comment.length - 2 : comment.length;
  while (start < end && comment[start] === '*') start++;
  while (end > start && comment[end - 1] === '*') end--;
  const prose = comment.slice(start, end)
    .split(cfg.allowMarker).join('')
    .replace(/^[\s*]+/gm, '')
    .replace(/[-\s]+/g, ' ')
    .trim();
  return prose.length >= cfg.minJustificationChars;
}

/** Every block comment in a statement's text, read from real trivia so code and strings never count. */
function blockComments(stmt, source) {
  const text = source.text;
  const out = [];
  const visit = (n) => {
    // JsxText has no trivia: its pos is the text itself, which must never read as a comment.
    if (n.getChildCount(source) === 0 && n.kind !== ts.SyntaxKind.JsxText) {
      const ranges = [...(ts.getTrailingCommentRanges(text, n.pos) ?? []), ...(ts.getLeadingCommentRanges(text, n.pos) ?? [])];
      for (const r of ranges) {
        if (r.kind === ts.SyntaxKind.MultiLineCommentTrivia) out.push(text.slice(r.pos, r.end));
      }
    }
    for (const c of n.getChildren(source)) visit(c);
  };
  visit(stmt);
  return out;
}
