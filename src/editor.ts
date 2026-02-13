import * as vscode from 'vscode';

// Possible positions when C-l is invoked consequtively
enum RecenterPosition {
  Middle,
  Top,
  Bottom
};

export class Editor {
	private lastKill: vscode.Position // if kill position stays the same, append to clipboard
	private justDidKill: boolean
	private centerState: RecenterPosition
	private outputChannel: vscode.OutputChannel

	private folded: boolean = false
	private justDidFolding: boolean = false
	private positionAfterFold: vscode.Position
	private selectionBeforeFold: vscode.Selection
	public removeMarkOnEdit: boolean = true
	private visibleLinesBeforeFold: number[] = []
	private counter = 0
	private position

	// Track whether swiper search window is active
	public isSwiperActive: boolean = false

	constructor(outputChannel: vscode.OutputChannel) {
		this.justDidKill = false
		this.lastKill = null
		this.centerState = RecenterPosition.Middle
		this.outputChannel = outputChannel

		vscode.window.onDidChangeActiveTextEditor(event => {
			this.lastKill = null
			this.justDidFolding = false
			this.visibleLinesBeforeFold = []
		})
		vscode.workspace.onDidChangeTextDocument(event => {
			if (!this.justDidKill) {
				this.lastKill = null
			}
			this.justDidKill = false
			this.justDidFolding = false
			if (this.removeMarkOnEdit) {
				vscode.commands.executeCommand('michal.exitMarkModeOnEdit'); // -- fix that to not execute it after block comment or block indent
			}
		})
		// vscode.window.onDidChangeTextEditorSelection(event => {
		// 	this.centerState = RecenterPosition.Middle
		// })
	}

	async executeWithoutRemovingMark(command: string): Promise<void> {
		this.removeMarkOnEdit = false
		await vscode.commands.executeCommand(command)
		this.removeMarkOnEdit = true
	}

	customCursorMove(command: string, inMarkMode: boolean): void {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;

		const doc = editor.document;
		const newSelections: vscode.Selection[] = [];

		for (const selection of editor.selections) {
			const pos = selection.active;
			let newPos: vscode.Position;
			if (command === "editorCursorWordPartRight") {
				newPos = this.findWordPartEndRight(pos);
			} else if (command === "editorCursorWordPartLeft") {
				newPos = this.findWordPartStartLeft(pos);
			} else if (command === "editorCursorWordRight") {
				newPos = this.findWordEndRight(pos);
			} else if (command === "editorCursorWordLeft") {
				newPos = this.findWordStartLeft(pos);
			} else {
				newPos = pos;
			}

			if (inMarkMode) {
				// Extend selection from anchor to new position
				newSelections.push(new vscode.Selection(selection.anchor, newPos));
			} else {
				// Move cursor without selection
				newSelections.push(new vscode.Selection(newPos, newPos));
			}
		}

		editor.selections = newSelections;
		editor.revealRange(new vscode.Range(newSelections[0].active, newSelections[0].active));
	}

	async customDelete(command: string): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;

		const edits: vscode.Range[] = [];

		for (const selection of editor.selections) {
			const pos = selection.active;
			let targetPos: vscode.Position;

			if (command === "editorDeleteWordPartRight") {
				targetPos = this.findWordPartEndRight(pos);
				edits.push(new vscode.Range(pos, targetPos));
			} else if (command === "editorDeleteWordPartLeft") {
				targetPos = this.findWordPartStartLeft(pos);
				edits.push(new vscode.Range(targetPos, pos));
			} else if (command === "editorDeleteWordRight") {
				targetPos = this.findWordEndRight(pos);
				edits.push(new vscode.Range(pos, targetPos));
			} else if (command === "editorDeleteWordLeft") {
				targetPos = this.findWordStartLeft(pos);
				edits.push(new vscode.Range(targetPos, pos));
			}
		}

		// Sort edits from end to start to avoid position shifts when ranges overlap
		edits.sort((a, b) => b.start.compareTo(a.start));

		// Merge overlapping ranges
		const mergedEdits: vscode.Range[] = [];
		for (const range of edits) {
			if (mergedEdits.length === 0) {
				mergedEdits.push(range);
			} else {
				const last = mergedEdits[mergedEdits.length - 1];
				// Check if ranges overlap or are adjacent (last.start <= range.end since sorted descending)
				if (last.start.isBeforeOrEqual(range.end)) {
					// Merge: extend to cover both ranges
					mergedEdits[mergedEdits.length - 1] = new vscode.Range(
						range.start.isBefore(last.start) ? range.start : last.start,
						last.end.isAfter(range.end) ? last.end : range.end
					);
				} else {
					mergedEdits.push(range);
				}
			}
		}

		await editor.edit(editBuilder => {
			for (const range of mergedEdits) {
				editBuilder.delete(range);
			}
		});
	}
	
	isWordEnd(prevChar: string, currChar: string): boolean {
		const prevIsWord = /\w/.test(prevChar);
		const currIsWord = /\w/.test(currChar);
		return !currIsWord && prevIsWord;
	}

	isWordPartEnd(prevChar: string, currChar: string): boolean {
		const prevIsWord = /\w/.test(prevChar);
		const currIsWord = /\w/.test(currChar);
		if (!prevIsWord) {
			return false;
		}
		// prevIsWord
		if (!currIsWord) {  
			return true;
		}
		// prevIsWord && currIsWord
		// word is [a-zA-Z0-9_]
		// Both are word characters - check for camelCase, digits, underscores
		const prevIsUpper = /[A-Z]/.test(prevChar);
		const currIsUpper = /[A-Z]/.test(currChar);
		
		const prevIsLower = /[a-z]/.test(prevChar);
		const currIsLower = /[a-z]/.test(currChar);
		const prevIsDigit = /[0-9]/.test(prevChar);
		const currIsDigit = /[0-9]/.test(currChar);
		const prevIsUnderscore = prevChar === '_';
		const currIsUnderscore = currChar === '_';

		if (prevIsUnderscore) {
			return false;
		}
		// !prevIsUnderscore
		if (currIsUnderscore) {
			return true;
		} 
		// both are word but not underscore is [a-zA-Z0-9]
		if (prevIsDigit != currIsDigit) {
			return true;
		}
		if (prevIsDigit && currIsDigit) {
			return false;
		}
		// both are [a-zA-Z]
		if (prevIsLower && currIsUpper ) {
			return true;
		}

		return false;
	}

	isWordStart(prevChar: string, currChar: string): boolean {
		const prevIsWord = /\w/.test(prevChar);
		const currIsWord = /\w/.test(currChar);
		return (currIsWord && !prevIsWord);
	}

	isWordPartStart(prevChar: string, currChar: string): boolean {
		const prevIsWord = /\w/.test(prevChar);
		const currIsWord = /\w/.test(currChar);
		if (!currIsWord) {
			return false;
		}
		// currIsWord
		if (!prevIsWord) {  
			return true;
		}
		// prevIsWord && currIsWord
		// word is [a-zA-Z0-9_]
		// Both are word characters - check for camelCase, digits, underscores
		const prevIsUpper = /[A-Z]/.test(prevChar);
		const currIsUpper = /[A-Z]/.test(currChar);
		
		const prevIsLower = /[a-z]/.test(prevChar);
		const currIsLower = /[a-z]/.test(currChar);
		const prevIsDigit = /[0-9]/.test(prevChar);
		const currIsDigit = /[0-9]/.test(currChar);
		const prevIsUnderscore = prevChar === '_';
		const currIsUnderscore = currChar === '_';

		if (currIsUnderscore) {
			return false;
		}
		// !currIsUnderscore
		if (prevIsUnderscore) {
			return true;
		} 
		// both are word but not underscore is [a-zA-Z0-9]
		if (prevIsDigit != currIsDigit) {
			return true;
		}
		if (prevIsDigit && currIsDigit) {
			return false;
		}
		// both are [a-zA-Z]
		if (prevIsLower && currIsUpper ) {
			return true;
		}

		return false;
	}

	getCharAt(pos: vscode.Position): string {
		const doc = vscode.window.activeTextEditor.document;
		return doc.lineAt(pos.line).text[pos.character] || '';
	}

	private findWordPartEndRight(pos: vscode.Position): vscode.Position {
		let next_pos = pos;
		while (true) {
			next_pos = this.nextPosition(pos);
			if (next_pos == null) {
				return pos;
			}
			if (this.isWordPartEnd(this.getCharAt(pos), this.getCharAt(next_pos))) {
				return next_pos;
			}
			pos = next_pos;
		}	
	}

	private findWordPartStartLeft(pos: vscode.Position): vscode.Position {
		let prev_pos = this.prevPosition(pos);
        if (prev_pos == null) {
			return pos;
		}
		pos = prev_pos;
		while(true) {
			prev_pos = this.prevPosition(pos);
			if (prev_pos == null) {
				return pos;
			}
			if (this.isWordPartStart(this.getCharAt(prev_pos), this.getCharAt(pos))) {
				return pos;
			}
			pos = prev_pos;
		}
	}

	private findWordEndRight(pos: vscode.Position): vscode.Position {
		let next_pos = pos;
		while (true) {
			next_pos = this.nextPosition(pos);
			if (next_pos == null) {
				return pos;
			}
			if (this.isWordEnd(this.getCharAt(pos), this.getCharAt(next_pos))) {
				return next_pos;
			}
			pos = next_pos;
		}	
	}

	private findWordStartLeft(pos: vscode.Position): vscode.Position {
		let prev_pos = this.prevPosition(pos);
        if (prev_pos == null) {
			return pos;
		}
		pos = prev_pos;
		while(true) {
			prev_pos = this.prevPosition(pos);
			if (prev_pos == null) {
				return pos;
			}
			if (this.isWordStart(this.getCharAt(prev_pos), this.getCharAt(pos))) {
				return pos;
			}
			pos = prev_pos;
		}
	}
	// fdf  fdfd_fdfd___fdfd   dfdfAlaMaKotaAAdf
	
	static isOnLastLine(): boolean {
		return vscode.window.activeTextEditor.selection.active.line == vscode.window.activeTextEditor.document.lineCount - 1
	}

	setStatusBarMessage(text: string): vscode.Disposable {
		return vscode.window.setStatusBarMessage(text, 1000);
	}

	setStatusBarPermanentMessage(text: string): vscode.Disposable {
		return vscode.window.setStatusBarMessage(text);
	}

	getSelectionRange(): vscode.Range {
		let selection = vscode.window.activeTextEditor.selection,
			start = selection.start,
			end = selection.end;

		return (start.character !== end.character || start.line !== end.line) ? new vscode.Range(start, end) : null;
	}

	getSelection(): vscode.Selection {
		return vscode.window.activeTextEditor.selection;
	}

	isRegionSelected(): boolean {
		return !this.getSelection().isEmpty;
	}

	getSelectionText(): string {
		let r = this.getSelectionRange()
		return r ? vscode.window.activeTextEditor.document.getText(r) : ''
	}

	getLineText(): string {
		const lineNumber = vscode.window.activeTextEditor.selection.active.line;
		return vscode.window.activeTextEditor.document.lineAt(lineNumber).text;	
	}

	getSelectionOrLineText(): string {
		if (this.isRegionSelected()) {
			return this.getSelectionText();
		}
		return this.getLineText();
	}

	setSelection(start: vscode.Position, end: vscode.Position): void {
		let editor = vscode.window.activeTextEditor;
		editor.selection = new vscode.Selection(start, end);
	}

	getCurrentPos(): vscode.Position {
		return vscode.window.activeTextEditor.selection.active
	}

	/**
	 * Advances a position by one character, moving to the next line if at end of line.
	 * Returns null if at end of document.
	 */
	nextPosition(pos: vscode.Position): vscode.Position | null {
		const doc = vscode.window.activeTextEditor.document;
		const lineText = doc.lineAt(pos.line).text;
		if (pos.character < lineText.length) {
			return new vscode.Position(pos.line, pos.character + 1);
		} else if (pos.line < doc.lineCount - 1) {
			return new vscode.Position(pos.line + 1, 0);
		}
		return null; // At end of document
	}

	/**
	 * Moves a position back by one character, moving to the previous line if at start of line.
	 * Returns null if at start of document.
	 */
	prevPosition(pos: vscode.Position): vscode.Position | null {
		const doc = vscode.window.activeTextEditor.document;
		if (pos.character > 0) {
			return new vscode.Position(pos.line, pos.character - 1);
		} else if (pos.line > 0) {
			const prevLineLength = doc.lineAt(pos.line - 1).text.length;
			return new vscode.Position(pos.line - 1, prevLineLength);
		}
		return null; // At start of document
	}
	
	getTopPos(): vscode.Position {
		return new vscode.Position(0, 0)
	}

	getTextFromTopToHere(): string {
		const from_here_to_top = new vscode.Range(this.getTopPos(), this.getCurrentPos());
		return vscode.window.activeTextEditor.document.getText(from_here_to_top);
	}
	
	// Kill to end of line
	async kill(): Promise<boolean> {
		// Ignore whatever we have selected before
		await vscode.commands.executeCommand("michal.exitMarkMode")

		let startPos = this.getCurrentPos(),
			isOnLastLine = Editor.isOnLastLine()

		// Move down an entire line (not just the wrapped part), and to the beginning.
		await vscode.commands.executeCommand("cursorMove", { to: "down", by: "line", select: false })
		if (!isOnLastLine) {
			await vscode.commands.executeCommand("cursorMove", { to: "wrappedLineStart" })
		}

		let endPos = this.getCurrentPos(),
			range = new vscode.Range(startPos, endPos),
			txt = vscode.window.activeTextEditor.document.getText(range)

		// If there is something other than whitespace in the selection, we do not cut the EOL too
		if (!isOnLastLine && !txt.match(/^\s*$/)) {
			await vscode.commands.executeCommand("cursorMove", {to: "left", by: "character"})
			endPos = this.getCurrentPos()
		}

		// Select it now, cut the selection, remember the position in case of multiple cuts from same spot
		this.setSelection(startPos, endPos)
		let promise = this.cut(this.lastKill != null && startPos.isEqual(this.lastKill))

		promise.then(() => {
			this.justDidKill = true
			this.lastKill = startPos
		})

		return promise
	}

	copy(): void {
		vscode.env.clipboard.writeText(this.getSelectionText())
		vscode.commands.executeCommand("michal.exitMarkMode")
	}

	async cut(appendClipboard?: boolean): Promise<boolean> {
		if (appendClipboard) {
			const text = await vscode.env.clipboard.readText();
			vscode.env.clipboard.writeText(text + this.getSelectionText())
		} else {
			vscode.env.clipboard.writeText(this.getSelectionText())
		}
		// ala ma kota
		let t = Editor.delete(this.getSelectionRange());
		vscode.commands.executeCommand("michal.exitMarkMode");
		return t
	}

	yank(): Thenable<{}> {
		this.justDidKill = false
		return Promise.all([
			vscode.commands.executeCommand("editor.action.clipboardPasteAction"),
			vscode.commands.executeCommand("michal.exitMarkMode")])
	}

	undo(): void {
		vscode.commands.executeCommand("undo");
	}

	private getFirstBlankLine(range: vscode.Range): vscode.Range {
		let doc = vscode.window.activeTextEditor.document;

		if (range.start.line === 0) {
			return range;
		}
		range = doc.lineAt(range.start.line - 1).range;
		while (range.start.line > 0 && range.isEmpty) {
			range = doc.lineAt(range.start.line - 1).range;
		}
		if (range.isEmpty) {
			return range;
		} else {
			return doc.lineAt(range.start.line + 1).range;
		}
	}

	async deleteBlankLines() {
		let selection = this.getSelection(),
			anchor = selection.anchor,
			doc = vscode.window.activeTextEditor.document,
			range = doc.lineAt(selection.start.line).range,
			nextLine: vscode.Position;

		if (range.isEmpty) {
			range = this.getFirstBlankLine(range);
			anchor = range.start;
			nextLine = range.start;
		} else {
			nextLine = range.start.translate(1, 0);
		}
		selection = new vscode.Selection(nextLine, nextLine);
		vscode.window.activeTextEditor.selection = selection;

		for (let line = selection.start.line;
				line < doc.lineCount - 1  && doc.lineAt(line).range.isEmpty;
		    	++line) {

			await vscode.commands.executeCommand("deleteRight")
		}
		vscode.window.activeTextEditor.selection = new vscode.Selection(anchor, anchor)
	}

	static delete(range: vscode.Range = null): Thenable<boolean> {
		if (range) {
			return vscode.window.activeTextEditor.edit(editBuilder => {
				editBuilder.delete(range);
			});
		}
	}

	deleteLine() : void {
		vscode.commands.executeCommand("michal.exitMarkMode"); // emulate Emacs
		vscode.commands.executeCommand("editor.action.deleteLines");
	}

	scrollLineToCenterTopBottom = () => {
		const editor = vscode.window.activeTextEditor
		const selection = editor.selection

		switch (this.centerState) {
			case RecenterPosition.Middle:
				this.centerState = RecenterPosition.Top;
				editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
				break;
			case RecenterPosition.Top:
				this.centerState = RecenterPosition.Bottom;
				editor.revealRange(selection, vscode.TextEditorRevealType.AtTop);
				break;
			case RecenterPosition.Bottom:
				this.centerState = RecenterPosition.Middle;
				// There is no AtBottom, so instead scroll a page up (without moving cursor).
				// The current line then ends up as the last line of the window (more or less)
				vscode.commands.executeCommand("scrollPageUp");
				break;
		}
	}

	breakLine() {
		vscode.commands.executeCommand("lineBreakInsert");
		vscode.commands.executeCommand("michal.cursorHome");
		vscode.commands.executeCommand("michal.cursorDown");
	}

	showMessage(message: string): void {
		vscode.window.showInformationMessage(message);
	}

	log(message: string): void {
        this.outputChannel.appendLine(message);
    }

	async jupyterExecCodeAboveInteractive(): Promise<void> {
		this.executeCodeInJupyter(this.getTextFromTopToHere());
	}

	async executeCodeInJupyter(code: string): Promise<void> {
		await vscode.commands.executeCommand("jupyter.execSelectionInteractive", code).then(() => {this.log("Executed code in Jupyter")});
	}	
	
	async jupyterExecLineOrRegionAndMaybeStep(): Promise<void> {
		const sth_selected = this.isRegionSelected();
		this.executeCodeInJupyter(this.getSelectionOrLineText());
		if (!sth_selected) {
			// if line was selected then step one line down.
			vscode.commands.executeCommand("cursorDown");
		}
	}

	getCurrentColumn() {
		const editor = vscode.window.activeTextEditor;
		return editor.selection.active.character;
	}
	getIndentLevelBasedOnCursorLocation(): number {
		return this.getCurrentColumn()
	}

	/**
	 * Folds all lines at the specified indent level.
	 * @param level The indent level to fold (1-based).
	 */
	foldAtIndentLevel(level: number): void {
		const editor = vscode.window.activeTextEditor;
		const doc = editor.document;

		let lines = []
		let previousIndentLevel = 0
		for (let i = 0; i < doc.lineCount; i++) {
			const line = doc.lineAt(i);
			const lineIndentLevel = line.firstNonWhitespaceCharacterIndex;
			if ((lineIndentLevel > level) && (lineIndentLevel > previousIndentLevel)) {
				lines.push(Math.max(i - 1, 0))  // I don't know whey I need to pass "i-1" here, but it works - I pass the previous line.
			}
			vscode.commands.executeCommand('editor.fold', { selectionLines: lines, levels: 1 });
			previousIndentLevel = lineIndentLevel
			
		}
	}
	getDocumentContent() {
		const editor = vscode.window.activeTextEditor;
		return editor.document.getText();
	}
	
	async toggleFold(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		
		if (this.folded) { // unfold
			const restorePosition = this.justDidFolding && this.getCurrentPos() === this.positionAfterFold
			vscode.commands.executeCommand("editor.unfoldAll");		
			if (restorePosition) {
				editor.selection = this.selectionBeforeFold
			} 
			this.folded = false;
			this.justDidFolding = false;			
		} else { // fold
			this.selectionBeforeFold = this.getSelection();
			this.visibleLinesBeforeFold = this.getVisibleLines();
			
			let level = this.getIndentLevelBasedOnCursorLocation();
			this.foldAtIndentLevel(level);
			await sleep(200); 
			this.positionAfterFold = this.getCurrentPos();
			this.folded = true;
			this.justDidFolding = true;
		}		
	}

	getVisibleLines(): number[] {
		const editor = vscode.window.activeTextEditor;
		const visibleLines: number[] = [];
		for (const range of editor.visibleRanges) {
			for (let line = range.start.line; line <= range.end.line; line++) {
				visibleLines.push(line);
			}
		}
		return visibleLines;
	}

	showLineAtTop(line_number: number) {
		const editor = vscode.window.activeTextEditor;
		const range = editor.document.lineAt(line_number).range;
		editor.revealRange(range,  vscode.TextEditorRevealType.AtTop);
	}

	getMultilineFromRegion() {
		const editor = vscode.window.activeTextEditor
		const selections = editor.selections;
		const hasMultipleSelecitons = selections.length > 1;
		if (hasMultipleSelecitons) return;
		const selection = editor.selection;
		const startLine = selection.start.line;
		const endLine = selection.end.line;
		if (startLine == endLine) return;

		vscode.commands.executeCommand('michal.exitMarkMode');
		const doc = vscode.window.activeTextEditor.document

		const new_selections: vscode.Selection[] = [];
		const column = this.getCurrentColumn();
		for (let line = startLine; line <= endLine; line++) {
			const pos = new vscode.Position(line, Math.min(editor.document.lineAt(line).text.length, column));
			new_selections.push(new vscode.Selection(pos, pos));
		}
		editor.selections = new_selections;
	}
	async test(): Promise<void> {
		this.showMessage("changed")
		this.log("log test")
		// const tab_names = vscode.window.visibleTextEditors.map(editor => editor.document.fileName)
		
		// for (const editor of vscode.window.visibleTextEditors) {
		// 	this.showMessage(editor.document.fileName)
		// 	sleep(100)
		// }
		// this.showMessage(vscode.window.visibleTextEditors.length.toString())
		// vscode.window.cre
		// this.showMessage(tab_names.toString())
		// const editor = vscode.window.activeTextEditor
		// const selection = editor.selection;
		// this.showMessage(`${startLine}  ${endLine}`)
		// // // this.toggleFold()
		// // let level = this.getIndentLevelBasedOnCursorLocation();
		// // const lineNumber = vscode.window.activeTextEditor.selection.active.line;
		// // let line =  vscode.window.activeTextEditor.document.lineAt(lineNumber)
		// // this.showMessage(`${this.getIndentLevelBasedOnCursorLocation()} ${line.firstNonWhitespaceCharacterIndex} `)
		// // this.showMessage(this.getVisibleLines().toString())

		// // let visibleLines = this.getVisibleLines();
		// // let currentLine = this.getCurrentPos().line
		// // const currentLineFromTop = visibleLines.indexOf(currentLine)
		// // this.showMessage(`${visibleLines.indexOf(currentLine)}`)

		// // this.showLineAtTop(331)
		// // vscode.Position().translate(0, 1) - next character
		// // vscode.Position
		// // vscode.getCurrentPos()
		
		// if (this.counter == 0) {
		// 	this.position = this.getCurrentPos();	
		// } else {
		// 	this.position = this.advancePosition(this.position, 1) //- next character
		// }
		// this.showMessage(`Current position is: ${this.position.line}, ${this.position.character}`);
		
		// // this.counter += 1;
		// // vscode.
		// // import { MoveOperations } from 'vs/editor/common/cursor/cursorMoveOperations';
		// // import { Position } from 'vs/editor/common/core/position';
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

