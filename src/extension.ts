import * as vscode from 'vscode';
import {Operation} from './operation';
import {Highlight} from './highlight';

var inMarkMode: boolean = false;
var markHasMoved: boolean = false;

function getLastNamePart(str: string): string {
    const parts = str.split('.');
    return parts[parts.length - 1]; // 'indentLines'
}

const outputChannel = vscode.window.createOutputChannel("Michal");

export function activate(context: vscode.ExtensionContext): void {
    let op = new Operation(outputChannel),
        commandList: string[] = [
            "C-g",

            // Edit
            "C-k", "C-w", "copy", "C-y", "C-x_C-o",
            "C-/", "C-j", "C-S_bs",

            // Navigation
            "C-l",

            // Jupyter
            "jupyterExecCodeAboveInteractive",
            "jupyterExecLineOrRegionAndMaybeStep",

            //other
            "toggleFold",
            "getMultilineFromRegion",
            "test"            
        ],
        cursorMoves: string[] = [
            "cursorUp", "cursorDown", "cursorLeft", "cursorRight",
            "cursorHome", "cursorEnd",
            "cursorWordLeft", "cursorWordRight",
            "cursorWordPartLeft", "cursorWordPartRight",
            "cursorPageDown", "cursorPageUp",
            "cursorTop", "cursorBottom"
        ],
        commandsThatDoNotRemoveMark: string[] = [
            'editor.action.indentLines',
            'outdent',
            "editor.action.addCommentLine",
            "editor.action.removeCommentLine",
            "undo",
            "redo"
        ];

    commandList.forEach(commandName => {
        context.subscriptions.push(registerCommand(commandName, op));
    });

    commandsThatDoNotRemoveMark.forEach(commandName => {

        context.subscriptions.push(vscode.commands.registerCommand(
            "michal."+ getLastNamePart(commandName), () => {
                op.editor.executeWithoutRemovingMark(commandName)
            })
        )
    });

    cursorMoves.forEach(element => {
        context.subscriptions.push(vscode.commands.registerCommand(
            "michal."+element, () => {
                if (inMarkMode) {
                    markHasMoved  = true;
                }
                vscode.commands.executeCommand(
                    inMarkMode ?
                    element+"Select" :
                    element
                );
            })
        )
    });

    initMarkMode(context);
    initHighlight(context);
}

export function deactivate(): void {
}

function initMarkMode(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.commands.registerCommand(
        'michal.enterMarkMode', () => {
            if (inMarkMode && !markHasMoved) {
                inMarkMode = false;
            } else {
                initSelection();
                inMarkMode = true;
                markHasMoved = false;
            }
        })
    );

    context.subscriptions.push(vscode.commands.registerCommand(
        'michal.exitMarkMode', () => {
            const selections = vscode.window.activeTextEditor.selections;
            const hasMultipleSelecitons = selections.length > 1;
            if (hasMultipleSelecitons) {
                const allSelectionsAreEmpty = selections.every(selection => selection.isEmpty);
                if (allSelectionsAreEmpty) {
                    vscode.commands.executeCommand("removeSecondaryCursors");
                } else {
                    // initSelection() is used here instead of `executeCommand("cancelSelection")`
                    // because `cancelSelection` command not only cancels selection state
                    // but also removes secondary cursors though these should remain in this case.
                    initSelection();
                }
            } else {
                // This `executeCommand("cancelSelection")` may be able to be replaced with `initSelection()`,
                // however, the core command is used here to follow its updates with ease.
                vscode.commands.executeCommand("cancelSelection");
            }

            if (inMarkMode) {
                inMarkMode = false;
            }
        })
    );

    context.subscriptions.push(vscode.commands.registerCommand(
        'michal.exitMarkModeOnEdit', () => {
            const selections = vscode.window.activeTextEditor.selections;
            const hasMultipleSelecitons = selections.length > 1;
            if (hasMultipleSelecitons) {
                const allSelectionsAreEmpty = selections.every(selection => selection.isEmpty);
                if (allSelectionsAreEmpty) {
                    // vscode.commands.executeCommand("removeSecondaryCursors");
                } else {
                    // initSelection() is used here instead of `executeCommand("cancelSelection")`
                    // because `cancelSelection` command not only cancels selection state
                    // but also removes secondary cursors though these should remain in this case.
                    initSelection();
                }
            } else {
                // This `executeCommand("cancelSelection")` may be able to be replaced with `initSelection()`,
                // however, the core command is used here to follow its updates with ease.
                vscode.commands.executeCommand("cancelSelection");
            }

            if (inMarkMode) {
                inMarkMode = false;
            }
        })
    );
}

function registerCommand(commandName: string, op: Operation): vscode.Disposable {
    return vscode.commands.registerCommand("michal." + commandName, op.getCommand(commandName));
}

function initSelection(): void {
    // Set new `anchor` and `active` values to all selections so that these are initialized to be empty.
    vscode.window.activeTextEditor.selections = vscode.window.activeTextEditor.selections.map(selection => {
        const currentPosition: vscode.Position = selection.active;
        return new vscode.Selection(currentPosition, currentPosition);
    });
}

function initHighlight(context: vscode.ExtensionContext): void {
    let highlight: Highlight = new Highlight();

    context.subscriptions.push(vscode.commands.registerCommand('michal.highlight.selectedWords', () => {
        highlight.SelectedWords();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('michal.highlight.clearWords', () => {
        highlight.ClearWords();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('michal.highlight.clearLastWord', () => {
        highlight.ClearLastWord();
    }));

    vscode.workspace.onDidChangeTextDocument(() => {
        highlight.RefeshSelectedWords();
    });

    vscode.window.onDidChangeActiveTextEditor(() => {
        highlight.DecorateSelectedWords();
    });
}
