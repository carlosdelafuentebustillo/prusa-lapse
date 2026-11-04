import fs from 'fs';
import path from 'path';
import { getOrcaSlicerPaths, getPluginSourceDir } from '../utils.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    let customTargetDir = null;
    if (request && typeof request.json === 'function') {
      try {
        const body = await request.json();
        if (body && body.targetDir) {
          customTargetDir = body.targetDir;
        }
      } catch (_) {
        // Body may be empty or unparseable, ignore
      }
    }

    const orcaPaths = getOrcaSlicerPaths();
    if (!customTargetDir && !process.env.ORCASLICER_PLUGINS_DIR && !orcaPaths.orcaDirectoryFound) {
      return Response.json({
        success: false,
        error: 'OrcaSlicer configuration directory not found. Please install and launch OrcaSlicer first.'
      }, { status: 400 });
    }

    const targetDir = customTargetDir || orcaPaths.targetDir;
    const dest = path.join(targetDir, 'prusalapse');
    const src = getPluginSourceDir();

    if (!src) {
      return Response.json({
        success: false,
        error: 'Plugin source directory (orcaslicer-plugin/prusalapse) not found'
      }, { status: 404 });
    }

    const isOrcaPluginsDir = targetDir.includes('orca_plugins');

    fs.mkdirSync(targetDir, { recursive: true });
    fs.cpSync(src, dest, {
      recursive: true,
      force: true,
      filter: (srcPath) => {
        if (srcPath.includes('__pycache__') || srcPath.endsWith('.pyc')) return false;
        // In orca_plugins, OrcaSlicer 2.5 enforces exactly one .py entry file per plugin directory
        if (isOrcaPluginsDir) {
          const base = path.basename(srcPath);
          if (base === 'injector.py' || base === '__init__.py') return false;
        }
        return true;
      }
    });

    const stateFile = path.join(dest, 'install_state.json');
    if (!fs.existsSync(stateFile)) {
      fs.writeFileSync(stateFile, JSON.stringify({
        installed_from: 'local',
        plugin_name: 'prusalapse',
        cloud_uuid: '',
        events: []
      }, null, 2), 'utf-8');
    }

    return Response.json({
      success: true,
      message: 'Installed successfully',
      pluginDir: dest
    });
  } catch (error) {
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
