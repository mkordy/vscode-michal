import {Editor} from './editor';

export class Operation {
    public editor: Editor;
    private commandList: { [key: string]: (...args: any[]) => any, thisArgs?: any } = {};

    constructor() {
        this.editor = new Editor();
        this.commandList = {
            'C-k': () => {
                this.editor.kill();
            },
            'C-w': () => {
                this.editor.cut()
            },
            'copy': () => {
                this.editor.copy()
            },
            'C-y': () => {
                this.editor.yank()
            },
            "C-x_C-o": () => {
                this.editor.deleteBlankLines();
            },
            "C-/": () => {
                this.editor.undo();
                this.editor.setStatusBarMessage("Undo!");
            },
            'C-j': () => {
                this.editor.breakLine();
            },
            'C-g': () => {
                this.editor.setStatusBarMessage("Quit");
            },
            "C-S_bs": () => {
                this.editor.deleteLine();
            },
            'C-l': () => {
                this.editor.scrollLineToCenterTopBottom()
            },
            'jupyterExecCodeAboveInteractive': () => {
                this.editor.jupyterExecCodeAboveInteractive()
            },
            'jupyterExecLineOrRegionAndMaybeStep': () => {
                this.editor.jupyterExecLineOrRegionAndMaybeStep()
            },
            'toggleFold': () => {
                this.editor.toggleFold()
            },
            'test': () => {
                this.editor.test()
            },
            'getMultilineFromRegion': () => {
                this.editor.getMultilineFromRegion()
            }
        };
    }

    getCommand(commandName: string): (...args: any[]) => any {
        return this.commandList[commandName];
    }
}
