// What shapes exist?

export interface ServerConfig {
  port: number;
  apiKey: string;
  workspace: string;
}

export interface FileInfo {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  modified: string;
  created: string;
  permissions: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}
