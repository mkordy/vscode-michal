import * as vscode from 'vscode';

const isDebug = false;

// Border colors for highlighting matches
const borderColors = ["red", "cyan", "green", "yellow", "BlueViolet", "Fuchsia"];

// Decoration styles for highlighting matches
const styles = borderColors.map(function(color) {
    return vscode.window.createTextEditorDecorationType({
        border: "solid",
        borderWidth: 'medium',
        borderColor: color
    });
});

// Active versions of styles with yellow background for the currently selected line
const activeStyles = borderColors.map(function(color) {
    return vscode.window.createTextEditorDecorationType({
        border: "solid",
        borderWidth: 'medium',
        borderColor: color,
        backgroundColor: "rgba(255, 255, 0, 0.3)"
    });
});

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

const MAX_HISTORY_SIZE = 50;

// Callback type for notifying when swiper active state changes
type SwiperActiveCallback = (isActive: boolean) => void;

export class Swiper {
    private state: SwiperState = {
        lastValue: PROMPT_STRING,
        lastSelected: null
    };

    private _isActive: boolean = false;
    private onActiveChangeCallback: SwiperActiveCallback = null;
    private currentItems: MatchedRange[] = [];
    private currentActiveLine: number = -1;
    
    // History for previous search values
    private history: string[] = [];
    private historyIndex: number = -1;
    private currentPick: vscode.QuickPick<SearchItem> = null;
    private tempCurrentValue: string = ''; // Store current input when navigating history

    /**
     * Returns whether the swiper search window is currently active
     */
    get isActive(): boolean {
        return this._isActive;
    }

    /**
     * Navigate to the previous (older) history entry
     */  
    historyUp(): void {
        if (!this.currentPick || this.history.length === 0) {
            return;
        }
        
        // If we're starting to navigate history, save current input
        if (this.historyIndex === -1) {
            this.tempCurrentValue = this.currentPick.value;
        }
        
        // Move to older entry, skipping entries that match current input
        while (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            if (this.history[this.historyIndex] !== this.currentPick.value) {
                this.currentPick.value = this.history[this.historyIndex];
                break;
            }
        }
    }

    showMessage(message: string): void {
        vscode.window.showInformationMessage(message);
    }

    /**
     * Navigate to the next (newer) history entry
     */
    historyDown(): void {
        if (!this.currentPick) {
            return;
        }
        
        if (this.historyIndex > 0) {
            // Move to newer entry
            this.historyIndex--;
            this.currentPick.value = this.history[this.historyIndex];
        } else if (this.historyIndex === 0) {
            // Return to current input
            this.historyIndex = -1;
            this.currentPick.value = this.tempCurrentValue;
        }
    }

    /**
     * Copy the line of the currently active search result to clipboard
     */
    copyCurrentLine(): void {
        if (!this.currentPick) {
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const activeItems = this.currentPick.activeItems;
        if (activeItems.length === 0) {
            return;
        }

        const currentItem = activeItems[0] as SearchItem;
        const lineText = editor.document.lineAt(currentItem.line).text;
        
        vscode.env.clipboard.writeText(lineText).then(() => {
            vscode.window.showInformationMessage('Line copied to clipboard');
        });
    }

    /**
     * Add a search value to history (avoiding duplicates)
     */
    private addToHistory(value: string): void {
        if (!value || value === PROMPT_STRING || value.length < 2) {
            return;
        }
        
        // Remove if already exists to avoid duplicates
        const existingIndex = this.history.indexOf(value);
        if (existingIndex !== -1) {
            this.history.splice(existingIndex, 1);
        }
        
        // Add to front of history
        this.history.unshift(value);
        
        // Keep history size bounded
        if (this.history.length > MAX_HISTORY_SIZE) {
            this.history.pop();
        }
    }

    /**
     * Set a callback to be notified when swiper active state changes
     */
    onActiveChange(callback: SwiperActiveCallback): void {
        this.onActiveChangeCallback = callback;
    }

    private setActive(active: boolean): void {
        this._isActive = active;
        vscode.commands.executeCommand('setContext', 'michal.swiperFocus', active);
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

        let activeLine: number = -1;
        if (this.state.lastValue === searchStr && this.state.lastSelected) {
            const lastSelected = this.state.lastSelected;
            const found = pick.items.find(function(it) {
                return (it.label === lastSelected.label) && (it.line === lastSelected.line);
            });
            if (found) {
                pick.activeItems = [found];
                activeLine = found.line;
            }
        } else if (initialCursorLine !== undefined) {
            const firstMatchBelow = pick.items.find(function(it) {
                return it.line >= initialCursorLine;
            });
            if (firstMatchBelow) {
                pick.activeItems = [firstMatchBelow];
                activeLine = firstMatchBelow.line;
            } else if (pick.items.length > 0) {
                // No match at or after cursor, use the closest match before cursor (last item)
                const lastItem = pick.items[pick.items.length - 1];
                pick.activeItems = [lastItem];
                activeLine = lastItem.line;
            }
        }
        this.updateMatchColor(items, activeLine >= 0 ? activeLine : undefined);
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
        activeStyles.forEach(function(s) {
            editor.setDecorations(s, []);
        });
    }

    private updateMatchColor(items: MatchedRange[], activeLine?: number): void {
        this.clearDecorations();
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        // Store for re-coloring when active item changes
        this.currentItems = items;
        if (activeLine !== undefined) {
            this.currentActiveLine = activeLine;
        }

        const colors: vscode.Range[][] = [];
        const activeColors: vscode.Range[][] = [];
        for (let c = 0; c < styles.length; c++) {
            colors.push([]);
            activeColors.push([]);
        }
        
        for (const item of items) {
            const isActive = item.line === this.currentActiveLine;
            for (let i = 0; i < item.ranges.length; i++) {
                const range = item.ranges[i];
                const start = range[0];
                const length = range[1];
                if (length === 0) {
                    continue;
                }
                const vscodeRange = new vscode.Range(
                    new vscode.Position(item.line, start),
                    new vscode.Position(item.line, start + length)
                );
                if (isActive) {
                    activeColors[i % activeStyles.length].push(vscodeRange);
                } else {
                    colors[i % styles.length].push(vscodeRange);
                }
            }
        }
        
        // Apply styles
        for (let i = 0; i < styles.length; i++) {
            editor.setDecorations(styles[i], colors[i]);
            editor.setDecorations(activeStyles[i], activeColors[i]);
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
        
        // Update decorations to highlight the active match differently
        this.updateMatchColor(this.currentItems, focused.line);
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
        this.currentPick = pick;
        this.historyIndex = -1;
        this.tempCurrentValue = '';

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
            // Add to history on successful accept
            self.addToHistory(pick.value);
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
            self.currentPick = null;
            pick.dispose();
        });

        pick.show();
    }
}
