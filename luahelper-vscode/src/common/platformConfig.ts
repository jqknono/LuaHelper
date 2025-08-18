'use strict';

import * as os from 'os';
import * as vscode from 'vscode';

/**
 * 平台特定配置管理器
 * 根据当前运行的操作系统平台自动设置不同的默认配置值
 */
export class PlatformConfigManager {
    
    /**
     * 获取当前平台类型
     * @returns 'windows' | 'linux' | 'other'
     */
    private static getCurrentPlatform(): 'windows' | 'linux' | 'other' {
        const platform = os.platform();
        if (platform === 'win32') {
            return 'windows';
        } else if (platform === 'linux') {
            return 'linux';
        } else {
            return 'other';
        }
    }

    /**
     * 获取TitanAgent 3.x的默认路径
     * @returns Windows: 'C:/Program Files/TitanAgent/TitanAgent.exe'
     *          Linux: '/titan/agent/titanagent'
     */
    static getTitanAgent3DefaultPath(): string {
        const platform = this.getCurrentPlatform();
        switch (platform) {
            case 'windows':
                return 'C:/Program Files/TitanAgent/TitanAgent.exe';
            case 'linux':
                return '/titan/agent/titanagent';
            default:
                return '/titan/agent/titanagent';
        }
    }

    /**
     * 获取TitanAgent 4.x的默认路径
     * @returns Windows: 'C:/Program Files/TitanAgent/bin/TitanAgent.exe'
     *          Linux: '/titan/agent/titanagent'
     */
    static getTitanAgent4DefaultPath(): string {
        const platform = this.getCurrentPlatform();
        switch (platform) {
            case 'windows':
                return 'C:/Program Files/TitanAgent/bin/TitanAgent.exe';
            case 'linux':
                return '/titan/agent/titanagent';
            default:
                return '/titan/agent/titanagent';
        }
    }

    /**
     * 获取默认工作目录
     * @returns Windows: 'C:/Program Files/TitanAgent/data/script'
     *          Linux: '/titan/agent/data/script'
     */
    static getDefaultWorkdir(): string {
        const platform = this.getCurrentPlatform();
        switch (platform) {
            case 'windows':
                return 'C:/Program Files/TitanAgent/data/script';
            case 'linux':
                return '/titan/agent/data/script';
            default:
                return '/titan/agent/data/script';
        }
    }

    /**
     * 初始化平台特定配置
     * 在插件激活时调用，根据当前平台设置适当的默认值
     */
    static initializePlatformConfigs(): void {
        const config = vscode.workspace.getConfiguration('luahelper.platform');
        
        // 检查配置是否已经设置，如果没有则使用平台默认值
        const titanagentPath3 = config.get<string>('titanagentPath3');
        if (!titanagentPath3 || titanagentPath3 === '/titan/agent/titanagent') {
            config.update('titanagentPath3', this.getTitanAgent3DefaultPath(), vscode.ConfigurationTarget.Global);
        }

        const titanagentPath4 = config.get<string>('titanagentPath4');
        if (!titanagentPath4 || titanagentPath4 === '/titan/agent/titanagent') {
            config.update('titanagentPath4', this.getTitanAgent4DefaultPath(), vscode.ConfigurationTarget.Global);
        }

        const workdir = config.get<string>('workdir');
        if (!workdir || workdir === '/titan/agent/data/script') {
            config.update('workdir', this.getDefaultWorkdir(), vscode.ConfigurationTarget.Global);
        }
    }

    /**
     * 获取当前配置的TitanAgent 3.x路径
     */
    static getCurrentTitanAgent3Path(): string {
        const config = vscode.workspace.getConfiguration('luahelper.platform');
        return config.get<string>('titanagentPath3') || this.getTitanAgent3DefaultPath();
    }

    /**
     * 获取当前配置的TitanAgent 4.x路径
     */
    static getCurrentTitanAgent4Path(): string {
        const config = vscode.workspace.getConfiguration('luahelper.platform');
        return config.get<string>('titanagentPath4') || this.getTitanAgent4DefaultPath();
    }

    /**
     * 获取当前配置的工作目录
     */
    static getCurrentWorkdir(): string {
        const config = vscode.workspace.getConfiguration('luahelper.platform');
        return config.get<string>('workdir') || this.getDefaultWorkdir();
    }
}
