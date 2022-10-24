/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
/*
 * activateDebug65xx.ts containes the shared extension code that can be executed both in node.js and the browser.
 */

'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import { Debug65xxSession } from './da65xx';

interface FileAccessor {
    readFile(path: string): Promise<Uint8Array>;
    writeFile(path: string, contents: Uint8Array): Promise<void>;
}

export function activateDebug65xx(context: vscode.ExtensionContext, factory?: vscode.DebugAdapterDescriptorFactory) {

	context.subscriptions.push(
		vscode.commands.registerCommand('extension.da65816.runEditorContents', (resource: vscode.Uri) => {
			let targetResource = resource;
			if (!targetResource && vscode.window.activeTextEditor) {
				targetResource = vscode.window.activeTextEditor.document.uri;
			}
			if (targetResource) {
				vscode.debug.startDebugging(undefined, {
					type: '65816',
					name: 'Run File',
					request: 'launch',
					program: targetResource.fsPath
				},
					{ noDebug: true }
				);
			}
		}),
		vscode.commands.registerCommand('extension.da65816.debugEditorContents', (resource: vscode.Uri) => {
            let targetResource = resource;
			if (!targetResource && vscode.window.activeTextEditor) {
				targetResource = vscode.window.activeTextEditor.document.uri;
			}
			if (targetResource) {
				vscode.debug.startDebugging(undefined, {
					type: '65816',
					name: 'Debug File',
					request: 'launch',
					program: targetResource.fsPath,
					stopOnEntry: true
				});
			}
        }),
		vscode.commands.registerCommand('extension.da65816.toggleFormatting', (variable) => {
			const ds = vscode.debug.activeDebugSession;
			if (ds) {
				ds.customRequest('toggleFormatting');
			}
		})
	);

    context.subscriptions.push(vscode.commands.registerCommand('extension.da65816.getProgramName', config => {
		return vscode.window.showInputBox({
			placeHolder: "Please enter the name of a markdown file in the workspace folder",
			value: "readme.md"
		});
	}));

	// register a configuration provider for '65816' debug type
	const provider = new DA65816ConfigurationProvider();
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('65816', provider));

	// register a dynamic configuration provider for '65816' debug type
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('65816', {
		provideDebugConfigurations(folder: WorkspaceFolder | undefined): ProviderResult<DebugConfiguration[]> {
			return [
				{
					name: "Dynamic Launch",
					request: "launch",
					type: "65816",
					program: "${file}"
				},
				{
					name: "Another Dynamic Launch",
					request: "launch",
					type: "65816",
					program: "${file}"
				},
				{
					name: "65816 Launch",
					request: "launch",
					type: "65816",
					program: "${file}"
				}
			];
		}
	}, vscode.DebugConfigurationProviderTriggerKind.Dynamic));

	if (!factory) {
		factory = new InlineDebugAdapterFactory();
	}
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('65816', factory));
	if ('dispose' in factory) {
		context.subscriptions.push(factory);
	}

	// override VS Code's default implementation of the debug hover
	// here we match only 65816 "variables", that are words starting with an '$'
	context.subscriptions.push(vscode.languages.registerEvaluatableExpressionProvider('cc65816', {
		provideEvaluatableExpression(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.EvaluatableExpression> {

//            const VARIABLE_REGEXP = /\$[a-z][a-z0-9]*/ig;
            const VARIABLE_REGEXP = /[a-z][a-z0-9_]*/ig;
			const line = document.lineAt(position.line).text;

			let m: RegExpExecArray | null;
			while (m = VARIABLE_REGEXP.exec(line)) {
				const varRange = new vscode.Range(position.line, m.index, position.line, m.index + m[0].length);

				if (varRange.contains(position)) {
					return new vscode.EvaluatableExpression(varRange);
				}
			}
			return undefined;
		}
	}));

	// override VS Code's default implementation of the "inline values" feature"
//	context.subscriptions.push(vscode.languages.registerInlineValuesProvider('cc65816', {
//
//		provideInlineValues(document: vscode.TextDocument, viewport: vscode.Range, context: vscode.InlineValueContext) : vscode.ProviderResult<vscode.InlineValue[]> {
//
//			const allValues: vscode.InlineValue[] = [];
//
//			for (let l = viewport.start.line; l <= context.stoppedLocation.end.line; l++) {
//				const line = document.lineAt(l);
//				var regExp = /\$([a-z][a-z0-9]*)/ig;	// variables are words starting with '$'
//				do {
//					var m = regExp.exec(line.text);
//					if (m) {
//						const varName = m[1];
//						const varRange = new vscode.Range(l, m.index, l, m.index + varName.length);
//
//						// some literal text
//						//allValues.push(new vscode.InlineValueText(varRange, `${varName}: ${viewport.start.line}`));
//
//						// value found via variable lookup
//						allValues.push(new vscode.InlineValueVariableLookup(varRange, varName, false));
//
//						// value determined via expression evaluation
//						//allValues.push(new vscode.InlineValueEvaluatableExpression(varRange, varName));
//					}
//				} while (m);
//			}
//
//			return allValues;
//		}
//	}));
}

class DA65816ConfigurationProvider implements vscode.DebugConfigurationProvider {

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {

		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'markdown') {
				config.type = '65816';
				config.name = 'Launch';
				config.request = 'launch';
				config.program = '${file}';
				config.stopOnEntry = true;
			}
		}

		if (!config.program) {
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return undefined;	// abort launch
			});
		}

		return config;
	}
}

//export const workspaceFileAccessor: FileAccessor = {
//	async readFile(path: string): Promise<Uint8Array> {
//		let uri: vscode.Uri;
//		try {
//			uri = pathToUri(path);
//		} catch (e) {
//			return new TextEncoder().encode(`cannot read '${path}'`);
//		}
//
//		return await vscode.workspace.fs.readFile(uri);
//	},
//	async writeFile(path: string, contents: Uint8Array) {
//		await vscode.workspace.fs.writeFile(pathToUri(path), contents);
//	}
//};

function pathToUri(path: string) {
	try {
		return vscode.Uri.file(path);
	} catch (e) {
		return vscode.Uri.parse(path);
	}
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {

	createDebugAdapterDescriptor(_session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
//        return new vscode.DebugAdapterInlineImplementation(new Debug65xxSession(workspaceFileAccessor));
        return new vscode.DebugAdapterInlineImplementation(new Debug65xxSession());
	}
}
