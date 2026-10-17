// Check script name resolution without requiring a full JavaScript typing migration.
import ts from 'typescript';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkScriptNames(files = ts.sys.readDirectory('scripts', ['.mjs'])) {
	const roots = files.map((file) => resolve(file));
	const program = ts.createProgram(roots, {
		allowJs: true,
		checkJs: true,
		noEmit: true,
		target: ts.ScriptTarget.ESNext,
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		types: ['node'],
		typeRoots: [resolve('node_modules/@types')],
		skipLibCheck: true
	});
	// Undefined names, spelling suggestions, and undefined shorthand properties.
	const unresolvedNames = new Set([2304, 2552, 18004]);
	return roots.flatMap((file) =>
		program
			.getSemanticDiagnostics(program.getSourceFile(file))
			.filter((diagnostic) => unresolvedNames.has(diagnostic.code))
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const diagnostics = checkScriptNames();
	if (diagnostics.length) {
		process.stderr.write(
			ts.formatDiagnosticsWithColorAndContext(diagnostics, {
				getCanonicalFileName: (file) => file,
				getCurrentDirectory: ts.sys.getCurrentDirectory,
				getNewLine: () => '\n'
			})
		);
		process.exitCode = 1;
	} else console.log('Script name checks passed.');
}
