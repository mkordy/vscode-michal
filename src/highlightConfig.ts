import * as vscode from 'vscode';

interface Color {
    light: string;
    dark: string;
}

export class HighlightConfig {
    constructor() {
        let config = vscode.workspace.getConfiguration('');

        const ignoreCaseConfig = config.get<boolean>('michal.highlight.configuration.ignoreCase');
        this.ignoreCase = ignoreCaseConfig === undefined ? true : ignoreCaseConfig;

        // Get all highlight colors
        this.decorationTypes = [];
        const colors = config.get<Color[]>('michal.highlight.configuration.colors');
        if (colors) {
            colors.forEach((color) => {
                let decorationType = vscode.window.createTextEditorDecorationType({
                    overviewRulerLane: vscode.OverviewRulerLane.Right,
                    light: {
                        overviewRulerColor: vscode.OverviewRulerLane.Right,
                        backgroundColor: color.light,
                    },
                    dark: {
                        overviewRulerColor: vscode.OverviewRulerLane.Right,
                        backgroundColor: color.dark,
                    }
                });
                this.decorationTypes.push(decorationType);
            });
        }
    }

    public IsIgnoreCase(): boolean {
        return this.ignoreCase;
    }

    public GetDecorationTypes(): vscode.TextEditorDecorationType[] {
        return this.decorationTypes;
    }

    private ignoreCase: boolean;
    private decorationTypes: vscode.TextEditorDecorationType[];
}
