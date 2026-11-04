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

    fs.mkdirSync(targetDir, { recursive: true });
    fs.cpSync(src, dest, { recursive: true, force: true });

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
