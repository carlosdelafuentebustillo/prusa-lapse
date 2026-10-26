import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';

const PLUGIN_ID = 'com.prusalapse.timelapse';

function getSourcePluginDir() {
  const repoPluginDir = path.resolve(process.cwd(), '..', 'prusaslicer-plugin', PLUGIN_ID);
  if (existsSync(repoPluginDir)) return repoPluginDir;
  return path.resolve(process.cwd(), 'prusaslicer-plugin', PLUGIN_ID);
}

function getPrusaSlicerLuaDirs() {
  const home = os.homedir();
  const platform = process.platform;
  const candidates = [];

  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(
      path.join(appData, 'PrusaSlicer', 'lua'),
      path.join(appData, 'PrusaSlicer-alpha', 'lua'),
      path.join(appData, 'PrusaSlicer-beta', 'lua')
    );
  } else if (platform === 'darwin') {
    const appSupport = path.join(home, 'Library', 'Application Support');
    candidates.push(
      path.join(appSupport, 'PrusaSlicer', 'lua'),
      path.join(appSupport, 'PrusaSlicer-alpha', 'lua'),
      path.join(appSupport, 'PrusaSlicer-beta', 'lua')
    );
  } else {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    candidates.push(
      path.join(configHome, 'PrusaSlicer', 'lua'),
      path.join(configHome, 'PrusaSlicer-alpha', 'lua'),
      path.join(configHome, 'PrusaSlicer-beta', 'lua')
    );
  }

  return candidates;
}

export async function GET() {
  try {
    const srcDir = getSourcePluginDir();
    const manifestPath = path.join(srcDir, 'manifest.json');
    const luaPath = path.join(srcDir, 'prusalapse.lua');

    if (!existsSync(manifestPath) || !existsSync(luaPath)) {
      return NextResponse.json({ error: 'Plugin bundle files not found' }, { status: 404 });
    }

    const zip = new AdmZip();
    zip.addLocalFile(manifestPath, PLUGIN_ID);
    zip.addLocalFile(luaPath, PLUGIN_ID);
    const buffer = zip.toBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${PLUGIN_ID}.zip"`
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const srcDir = getSourcePluginDir();
    const manifestPath = path.join(srcDir, 'manifest.json');
    const luaPath = path.join(srcDir, 'prusalapse.lua');

    if (!existsSync(manifestPath) || !existsSync(luaPath)) {
      return NextResponse.json({ error: 'Plugin source files not found' }, { status: 404 });
    }

    const luaDirs = getPrusaSlicerLuaDirs();
    const installedPaths = [];

    // Install to primary PrusaSlicer dir, plus any existing alpha/beta dirs
    for (let i = 0; i < luaDirs.length; i++) {
      const luaBaseDir = luaDirs[i];
      const parentDir = path.dirname(luaBaseDir);
      if (i === 0 || existsSync(parentDir)) {
        const targetBundleDir = path.join(luaBaseDir, PLUGIN_ID);
        await fs.mkdir(targetBundleDir, { recursive: true });
        await fs.copyFile(manifestPath, path.join(targetBundleDir, 'manifest.json'));
        await fs.copyFile(luaPath, path.join(targetBundleDir, 'prusalapse.lua'));
        installedPaths.push(targetBundleDir);
      }
    }

    return NextResponse.json({
      success: true,
      installedPaths
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
