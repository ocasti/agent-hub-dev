import type { IpcMain } from 'electron';
import { execFile } from 'child_process';

export function registerGithubHandlers(ipcMain: IpcMain) {
  ipcMain.handle(
    'github:fetchPRComments',
    async (_event, projectPath: string, prNumber: number) => {
      return new Promise((resolve, reject) => {
        execFile(
          'gh',
          [
            'pr',
            'view',
            String(prNumber),
            '--json',
            'comments,reviews,title,state',
          ],
          { cwd: projectPath },
          (error, stdout, stderr) => {
            if (error) {
              reject(new Error(`gh CLI error: ${stderr || error.message}`));
              return;
            }
            try {
              const data = JSON.parse(stdout);
              resolve(data);
            } catch {
              reject(new Error(`Failed to parse gh output: ${stdout}`));
            }
          }
        );
      });
    }
  );
}
