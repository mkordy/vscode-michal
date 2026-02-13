import * as vscode from 'vscode';
import {HighlightConfig} from './highlightConfig';

export class Highlight {
    constructor() {
        this.selectedWords = [];
        this.decorators = [];
        this.config = new HighlightConfig();
        this.decorators = this.config.GetDecorationTypes();
    }

    public ClearWords(): void {
        this.selectedWords = [];
        this.DecorateSelectedWords();
    }

    public ClearLastWord(): void {
        this.selectedWords.pop();
        this.DecorateSelectedWords();
    }

    public SelectedWords(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        let selectedWord = this.GetSelectedWord(editor);
        if (selectedWord === "") {
            return;
        }

        // find exist in words
        let idx = this.selectedWords.findIndex((word) => {
            return word === selectedWord;
        });
        if (idx == -1) {
            // Add to list; first look for an empty ('') slot to reuse
            idx = this.selectedWords.findIndex((word) => {
                return word === '';
            });
            if (idx == -1) {
                this.selectedWords.push(selectedWord);
            } else {
                this.selectedWords[idx] = selectedWord;
            }
        } else {
            // Don't actually delete; assign '' to mark as deleted. 
            // Reason: actual deletion would shift array positions and cause incorrect color assignments.
            this.selectedWords[idx] = '';
        }

        this.DecorateSelectedWords();
    }

    public RefeshSelectedWords(): void {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        this.timeout = setTimeout(() => {
            this.DecorateSelectedWords();
        }, 500);
    }

    public DecorateSelectedWords(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        let decorations: vscode.DecorationOptions[][] = [];
        this.decorators.forEach(() => {
            let decoration: vscode.DecorationOptions[] = [];
            decorations.push(decoration);
        });

        const text = editor.document.getText();
        const flags = this.config.IsIgnoreCase() ? 'gi' : 'g';
        this.selectedWords.forEach((selectedWord: string, idx: number) => {
            if (selectedWord == '') {
                return;
            }

            const regEx = new RegExp(selectedWord, flags);
            let execArray = regEx.exec(text);
            while (execArray != null) {
                const startPos = editor.document.positionAt(execArray.index);
                const endPos = editor.document.positionAt(execArray.index + execArray[0].length);
                const decorationPos = { range: new vscode.Range(startPos, endPos) };
                decorations[idx % decorations.length].push(decorationPos);

                execArray = regEx.exec(text);
            }
        });

        this.decorators.forEach((decorator: vscode.TextEditorDecorationType, idx: number) => {
            editor.setDecorations(decorator, decorations[idx]);
        })
    }

    private GetSelectedWord(editor: vscode.TextEditor) : string {
        const select = editor.selection;
        let selectedWord = editor.document.getText(select);
        let isExplicitSelection = !!selectedWord;
        
        if (!selectedWord) {
            const range = editor.document.getWordRangeAtPosition(select.start);
            if (range) {
                selectedWord = editor.document.getText(range);
            }
        }

        if (!selectedWord) {
            return "";
        }

        const escaped = selectedWord.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
        
        // If no explicit selection (word at cursor), add word boundaries for whole word matching
        // If explicit selection, match exactly what was selected
        return isExplicitSelection ? escaped : '\\b' + escaped + '\\b';
    }

    private decorators: vscode.TextEditorDecorationType[];
    private selectedWords: string[];
    private config: HighlightConfig;
    private timeout: any;
}
