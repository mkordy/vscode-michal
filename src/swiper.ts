import * as vscode from 'vscode';

const isDebug = false;

// Decoration styles for highlighting matches
const styles = [
    vscode.window.createTextEditorDecorationType({
        border: "solid",
        borderWidth: 'medium',
        borderColor: "red"
    }),
    vscode.window.createTextEditorDecorationType({
        border: "solid",
        borderWidth: 'medium',
        borderColor: "cyan"
    }),
    vscode.window.createTextEditorDecorationType({
        border: "solid",
        borderWidth: 'medium',
        borderColor: "green"
    }),
    vscode.window.createTextEditorDecorationType({
        border: "solid",
        borderWidth: 'medium',
        borderColor: "yellow"
    }),
    vscode.window.createTextEditorDecorationType({
        border: "solid",
        borderWidth: 'medium',
        borderColor: "BlueViolet"
    }),
    vscode.window.createTextEditorDecorationType({
        border: "solid",
        borderWidth: 'medium',
        borderColor: "Fuchsia"
    }),
];

const PROMPT_STRING = "type 2 or more chars to search";

interface ParsedSearch {
    pattern: string;
    isRegex: boolean;
    caseSensitive: boolean;
    negate: boolean;
}

interface MatchedRange {
    line: number;
    ranges: number[][];
}

interface SearchItem extends MatchedRange {
    label: string;
    description: string;
}

interface SwiperState {
    lastValue: string;
    lastSelected: SearchItem;
}

// Callback type for notifying when swiper active state changes
type SwiperActiveCallback = (isActive: boolean) => void;

export class Swiper {
    private state: SwiperState = {
        lastValue: PROMPT_STRING,
        lastSelected: null
    };

    private _isActive: boolean = false;
    private onActiveChangeCallback: SwiperActiveCallback = null;

    /**
     * Returns whether the swiper search window is currently active
     */
    get isActive(): boolean {
        return this._isActive;
    }

    /**
     * Set a callback to be notified when swiper active state changes
     */
    onActiveChange(callback: SwiperActiveCallback): void {
        this.onActiveChangeCallback = callback;
    }

    private setActive(active: boolean): void {
        this._isActive = active;
        if (this.onActiveChangeCallback) {
            this.onActiveChangeCallback(active);
        }
    }

    private parseSearchString(searchStr: string): ParsedSearch[] {
        if (!searchStr.trim().length) {
            return [];
        }
        return searchStr.split(" ")
            .map(subSearch => subSearch.trim())
            .filter(subSearch => subSearch)
            .map(subSearch => {
                const isNegate = subSearch.startsWith("!");
                return {
                    pattern: isNegate ? subSearch.slice(1) : subSearch,
                    isRegex: isNegate ? subSearch.startsWith("!/") : subSearch.startsWith("/"),
                    caseSensitive: /[A-Z]/.test(subSearch),
                    negate: subSearch.startsWith("!")
                };
            });
    }

    private searchContent(parsed: ParsedSearch[]): MatchedRange[] {
        const items: MatchedRange[] = [];
        const editor = vscode.window.activeTextEditor;
        if (!editor) return items;
        const doc = editor.document;

        for (let i = 0; i < doc.lineCount; i++) {
            const matches = this.searchLine(i, doc.lineAt(i).text, parsed);
            if (matches) {
                items.push(matches);
            }
        }
        return items;
    }

    private searchLine(lineIndex: number, line: string, parsed: ParsedSearch[]): MatchedRange {
        const matchedRange: MatchedRange = {
            line: lineIndex,
            ranges: []
        };

        for (const p of parsed) {
            if (p.isRegex) {
                const splitRegex = p.pattern.match(new RegExp('^/(.*?)/([gimy]*)$'));
                if (!splitRegex) {
                    return null;
                }
                const pattern = splitRegex[1];
                const flags = splitRegex[2];
                const regex = new RegExp(pattern, flags);
                const m = regex.exec(line);
                if (!m && !p.negate) {
                    return null;
                } else if (m && p.negate) {
                    return null;
                } else if (!m && p.negate) {
                    continue;
                } else if (m) {
                    matchedRange.ranges.push([m.index, m[0].length]);
                }
            } else {
                const m = p.caseSensitive ? line.indexOf(p.pattern) : line.toLowerCase().indexOf(p.pattern);
                if (p.negate) {
                    if (m !== -1) {
                        return null;
                    }
                } else {
                    if (m === -1) {
                        return null;
                    } else {
                        matchedRange.ranges.push([m, p.pattern.length]);
                    }
                }
            }
        }
        return matchedRange;
    }

    private search(searchStr: string, pick: vscode.QuickPick<SearchItem>, initialCursorLine: number): void {
        if (searchStr.length < 2 || searchStr === PROMPT_STRING) {
            return;
        }
        const parsed = this.parseSearchString(searchStr);
        const items = this.searchContent(parsed);

        if (isDebug) {
            console.log(searchStr);
            console.log(JSON.stringify(parsed));
            console.log(JSON.stringify(items));
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const doc = editor.document;

        pick.items = items.map(match => {
            return {
                label: this.leftPad(match.line + 1) + ": " + searchStr + " ",
                description: doc.lineAt(match.line).text,
                line: match.line,
                ranges: match.ranges
            };
        });

        if (this.state.lastValue === searchStr && this.state.lastSelected) {
            const lastSelected = this.state.lastSelected;
            const found = pick.items.find(function(it) {
                return (it.label === lastSelected.label) && (it.line === lastSelected.line);
            });
            if (found) {
                pick.activeItems = [found];
            }
        } else if (initialCursorLine !== undefined) {
            const firstMatchBelow = pick.items.find(function(it) {
                return it.line >= initialCursorLine;
            });
            if (firstMatchBelow) {
                pick.activeItems = [firstMatchBelow];
            }
        }
        this.updateMatchColor(items);
    }

    private leftPad(lineN: number): string {
        const lineNStr = lineN.toString();
        return "0".repeat(Math.max(0, 4 - lineNStr.length)) + lineNStr;
    }

    private clearDecorations(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        styles.forEach(function(s) {
            editor.setDecorations(s, []);
        });
    }

    private updateMatchColor(items: MatchedRange[]): void {
        this.clearDecorations();
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const colors: vscode.Range[][] = [];
        for (let c = 0; c < styles.length; c++) {
            colors.push([]);
        }
        
        for (const item of items) {
            for (let i = 0; i < item.ranges.length; i++) {
                const range = item.ranges[i];
                const start = range[0];
                const length = range[1];
                if (length === 0) {
                    continue;
                }
                colors[i % styles.length].push(
                    new vscode.Range(
                        new vscode.Position(item.line, start),
                        new vscode.Position(item.line, start + length)
                    )
                );
            }
        }
        for (let i = 0; i < colors.length; i++) {
            editor.setDecorations(styles[i], colors[i]);
        }
    }

    private jumpTo(selected: SearchItem): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const lastIndex = selected.ranges.length > 0 ? selected.ranges[selected.ranges.length - 1] : null;
        const start = lastIndex ? lastIndex[0] : 0;
        const end = lastIndex ? lastIndex[0] + lastIndex[1] : 0;
        const selectMatch = vscode.workspace.getConfiguration("michal.swiper").get("selectMatch");
        editor.selections = [
            new vscode.Selection(
                new vscode.Position(selected.line, selectMatch ? start : end),
                new vscode.Position(selected.line, end)
            )
        ];
    }

    private firstOrNull<T>(items: T[]): T {
        if (!items.length || !items[0]) {
            return null;
        }
        return items[0];
    }

    private resortCursorIfNoneSelected(pick: vscode.QuickPick<SearchItem>, previousSelection: vscode.Selection): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        if (pick.selectedItems.length === 0) {
            editor.revealRange(
                new vscode.Range(previousSelection.start, previousSelection.end),
                vscode.TextEditorRevealType.InCenter
            );
            editor.selection = previousSelection;
        }
    }

    private focusOnActiveItem(focused: SearchItem): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const start = new vscode.Position(focused.line, 0);
        const end = new vscode.Position(focused.line, 0);
        editor.revealRange(
            new vscode.Range(start, end),
            vscode.TextEditorRevealType.InCenter
        );
        editor.selection = new vscode.Selection(start, end);
    }

    /**
     * Start the swiper search
     */
    swipe(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const currentSelection = editor.selection;
        const initialCursorLine = currentSelection.active.line;

        // If text is selected or cursor is on a word, use it as initial search
        const selectedText = editor.document.getText(editor.selection);
        const wordRange = editor.document.getWordRangeAtPosition(currentSelection.start);
        const wordAtCursor = wordRange ? editor.document.getText(wordRange) : '';
        const initialSearch = selectedText || wordAtCursor;
        if (initialSearch) {
            this.state = {
                lastValue: initialSearch,
                lastSelected: null
            };
        }

        const pick = vscode.window.createQuickPick<SearchItem>();
        const self = this;

        pick.canSelectMany = false;
        pick.matchOnDescription = true;
        pick.value = this.state.lastValue;

        // Mark swiper as active
        this.setActive(true);

        pick.onDidChangeValue(function(value) {
            self.search(value, pick, initialCursorLine);
        });

        pick.onDidAccept(function() {
            const selected = self.firstOrNull(pick.selectedItems as SearchItem[]);
            if (isDebug) {
                console.log("selected: " + JSON.stringify(selected));
            }
            if (!selected) {
                return;
            }
            self.state = {
                lastValue: pick.value,
                lastSelected: selected
            };
            pick.hide();
            self.jumpTo(self.state.lastSelected);
        });

        pick.onDidChangeActive(function(items) {
            const focused = self.firstOrNull(items as SearchItem[]);
            if (!focused) {
                return;
            }
            self.focusOnActiveItem(focused);
        });

        pick.onDidHide(function() {
            self.clearDecorations();
            self.resortCursorIfNoneSelected(pick, currentSelection);
            // Mark swiper as inactive
            self.setActive(false);
            pick.dispose();
        });

        pick.show();
    }
}
