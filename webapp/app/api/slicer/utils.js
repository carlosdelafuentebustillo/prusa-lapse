import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

/**
 * Resolves OrcaSlicer configuration and plugins paths based on OS:
 * - Windows: %APPDATA%\OrcaSlicer\plugins (fallback: %USERPROFILE%\AppData\Roaming\OrcaSlicer\plugins)
 * - macOS: ~/Library/Application Support/OrcaSlicer/plugins
 * - Linux: ~/.config/OrcaSlicer/plugins (or $XDG_CONFIG_HOME/OrcaSlicer/plugins)
 */
export function getOrcaSlicerPaths(env = process.env, platform = process.platform) {
  let orcaConfigDir;
  const isWin = platform === 'win32';

  if (isWin) {
    const appData = env.APPDATA || (env.USERPROFILE ? path.join(env.USERPROFILE, 'AppData', 'Roaming') : path.join(os.homedir(), 'AppData', 'Roaming'));
    orcaConfigDir = path.join(appData, 'OrcaSlicer');
  } else if (platform === 'darwin') {
    const homeDir = env.HOME || os.homedir();
    orcaConfigDir = path.join(homeDir, 'Library', 'Application Support', 'OrcaSlicer');
  } else {
    const homeDir = env.HOME || os.homedir();
    const configDir = env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
    orcaConfigDir = path.join(configDir, 'OrcaSlicer');
  }

  const targetDir = env.ORCASLICER_PLUGINS_DIR || path.join(orcaConfigDir, 'plugins');
  const pluginDir = path.join(targetDir, 'prusalapse');
  const pluginFile = path.join(pluginDir, 'plugin.py');

  return {
    orcaConfigDir,
    targetDir,
    pluginDir,
    pluginFile,
    orcaDirectoryFound: fs.existsSync(orcaConfigDir),
    installed: fs.existsSync(pluginFile)
  };
}

/**
 * Resolves the location of orcaslicer-plugin/prusalapse in the project repository.
 */
export function getPluginSourceDir() {
  let fileDir = '';
  try {
    if (typeof __dirname !== 'undefined') {
      fileDir = __dirname;
    } else if (import.meta?.url) {
      fileDir = path.dirname(fileURLToPath(import.meta.url));
    }
  } catch (_) {}

  const candidates = [
    path.resolve(process.cwd(), 'orcaslicer-plugin', 'prusalapse'),
    path.resolve(process.cwd(), '..', 'orcaslicer-plugin', 'prusalapse'),
    fileDir ? path.resolve(fileDir, '..', '..', '..', '..', 'orcaslicer-plugin', 'prusalapse') : null
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'plugin.py'))) {
      return candidate;
    }
  }

  return null;
}
