import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { searchFiles } from 'wave-agent-sdk';

export class FileService {
    public async findWorkspaceFiles(filterText: string): Promise<Record<string, string | boolean>[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        try {
            const workspacePath = workspaceFolder.uri.fsPath;
            
            // Use searchFiles from SDK for more efficient file searching
            const fileItems = await searchFiles(filterText || '', {
                maxResults: 20, // Limit total results to 20 for better UX
                workingDirectory: workspacePath,
            });

            // Convert FileItem objects to the format expected by the UI
            const allItems = fileItems.map((item) => {
                const relativePath = item.path;
                const fullPath = path.join(workspacePath, relativePath);
                
                // Handle trailing slashes for directories to get the correct name
                // This ensures robust name extraction regardless of whether the SDK returns trailing slashes
                const normalizedPath = relativePath.endsWith('/') ? relativePath.slice(0, -1) : relativePath;
                const name = path.basename(normalizedPath);
                
                const extensionMatch = name.match(/\.([^.]+)$/);
                const extension = extensionMatch ? extensionMatch[1] : '';
                const isDirectory = item.type === 'directory';

                return {
                    path: fullPath,
                    relativePath: relativePath,
                    name: name,
                    extension: extension,
                    icon: isDirectory ? 'codicon-folder' : 'codicon-file',
                    isDirectory: isDirectory
                };
            });

            // Sort by relevance
            allItems.sort((a, b) => {
                const aNameMatch = a.name.toLowerCase().startsWith((filterText || '').toLowerCase());
                const bNameMatch = b.name.toLowerCase().startsWith((filterText || '').toLowerCase());

                if (aNameMatch && !bNameMatch) return -1;
                if (!aNameMatch && bNameMatch) return 1;

                // Prefer directories over files
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;

                return a.name.localeCompare(b.name);
            });

            return allItems;
        } catch (error) {
            console.error('搜索工作区文件失败:', error);
            return [];
        }
    }

    public async uploadFilesToArtifacts(files: Array<{ name: string; data: ArrayBuffer }>): Promise<{ uploadedFiles: string[], errors: string[] }> {
        // Create temporary artifacts directory if it doesn't exist
        const artifactsDir = path.join(os.tmpdir(), 'wave-artifacts');
        if (!fs.existsSync(artifactsDir)) {
            fs.mkdirSync(artifactsDir, { recursive: true });
        }

        const uploadedFiles: string[] = [];
        const errors: string[] = [];

        for (const file of files) {
            try {
                const fileName = file.name;
                const filePath = path.join(artifactsDir, fileName);
                
                // Handle potential file name conflicts
                let finalPath = filePath;
                let counter = 1;
                while (fs.existsSync(finalPath)) {
                    const ext = path.extname(fileName);
                    const baseName = path.basename(fileName, ext);
                    finalPath = path.join(artifactsDir, `${baseName}_${counter}${ext}`);
                    counter++;
                }

                // Convert ArrayBuffer to Buffer for writing
                const buffer = Buffer.from(file.data);
                fs.writeFileSync(finalPath, buffer);
                
                uploadedFiles.push(finalPath);
                console.log(`成功上传文件到临时目录: ${finalPath}`);
            } catch (error) {
                console.error(`上传文件 ${file.name} 失败:`, error);
                errors.push(`${file.name}: ${error}`);
            }
        }

        return { uploadedFiles, errors };
    }
}
