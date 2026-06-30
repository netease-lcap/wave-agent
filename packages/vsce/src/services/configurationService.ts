import * as vscode from 'vscode';

export interface ConfigurationData {
    serverUrl?: string;
    apiKey?: string;
    headers?: string;
    baseURL?: string;
    model?: string;
    fastModel?: string;
    language?: string;
    /** Environment variable values (read-only, for placeholder display) */
    envServerUrl?: string;
    envApiKey?: string;
    envHeaders?: string;
    envBaseUrl?: string;
    envModel?: string;
    envFastModel?: string;
}

/** Mask a secret value, keeping first 4 and last 4 characters visible */
function maskSecret(value: string): string {
    if (value.length <= 10) return '****';
    return value.slice(0, 4) + '****' + value.slice(-4);
}

export class ConfigurationService {
    constructor(private context: vscode.ExtensionContext) {}

    public async loadConfiguration(): Promise<ConfigurationData> {
        return {
            serverUrl: this.context.globalState.get<string>('serverUrl') || '',
            apiKey: this.context.globalState.get<string>('apiKey') || '',
            headers: this.context.globalState.get<string>('headers') || '',
            baseURL: this.context.globalState.get<string>('baseURL') || '',
            model: this.context.globalState.get<string>('model') || '',
            fastModel: this.context.globalState.get<string>('fastModel') || '',
            language: this.context.globalState.get<string>('language') || 'Chinese',
            envServerUrl: process.env.WAVE_SERVER_URL || undefined,
            envApiKey: process.env.WAVE_API_KEY ? maskSecret(process.env.WAVE_API_KEY) : undefined,
            envHeaders: process.env.WAVE_CUSTOM_HEADERS || undefined,
            envBaseUrl: process.env.WAVE_BASE_URL || undefined,
            envModel: process.env.WAVE_MODEL || undefined,
            envFastModel: process.env.WAVE_FAST_MODEL || undefined
        };
    }

    public async saveConfiguration(configData: Partial<ConfigurationData>): Promise<void> {
        try {
            if (configData.serverUrl !== undefined) await this.context.globalState.update('serverUrl', configData.serverUrl);
            if (configData.apiKey !== undefined) await this.context.globalState.update('apiKey', configData.apiKey);
            if (configData.headers !== undefined) await this.context.globalState.update('headers', configData.headers);
            if (configData.baseURL !== undefined) await this.context.globalState.update('baseURL', configData.baseURL);
            if (configData.model !== undefined) await this.context.globalState.update('model', configData.model);
            if (configData.fastModel !== undefined) await this.context.globalState.update('fastModel', configData.fastModel);
            if (configData.language !== undefined) await this.context.globalState.update('language', configData.language);
        } catch (error) {
            console.error('Failed to save configuration:', error);
            throw error;
        }
    }
}
