import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';

const PLUGIN_ID = 'com.prusalapse.timelapse';

function getPluginRootDir() {
  const repoPluginRoot = path.resolve(process.cwd(), '..', 'prusaslicer-plugin');
  if (existsSync(repoPluginRoot)) return repoPluginRoot;
  return path.resolve(process.cwd(), 'prusaslicer-plugin');
}

function getSourcePluginDir() {
  return path.join(getPluginRootDir(), PLUGIN_ID);
}

function getPrusaSlicerDataDirs() {
  const home = os.homedir();
  const platform = process.platform;
  const folderNames = [
    'PrusaSlicer3-dev',
    'PrusaSlicer3',
    'PrusaSlicer-alpha',
    'PrusaSlicer-beta',
    'PrusaSlicer'
  ];

  let baseDir;
  if (platform === 'win32') {
    baseDir = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  } else if (platform === 'darwin') {
    baseDir = path.join(home, 'Library', 'Application Support');
  } else {
    baseDir = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  }

  return folderNames.map(name => path.join(baseDir, name));
}

export async function GET() {
  try {
    const pluginRoot = getPluginRootDir();
    const preSignedZipPath = path.join(pluginRoot, `${PLUGIN_ID}.zip`);

    if (existsSync(preSignedZipPath)) {
      const buffer = await fs.readFile(preSignedZipPath);
      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${PLUGIN_ID}.zip"`
        }
      });
    }

    const srcDir = getSourcePluginDir();
    const manifestPath = path.join(srcDir, 'manifest.json');
    const luaPath = path.join(srcDir, 'prusalapse.lua');

    if (!existsSync(manifestPath) || !existsSync(luaPath)) {
      return NextResponse.json({ error: 'Plugin bundle files not found' }, { status: 404 });
    }

    const zip = new AdmZip();
    const files = await fs.readdir(srcDir);
    for (const f of files) {
      zip.addLocalFile(path.join(srcDir, f));
    }
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
    const pluginRoot = getPluginRootDir();
    const srcDir = getSourcePluginDir();
    const pubKeyPath = path.join(pluginRoot, 'prusalapse.pub.pem');

    if (!existsSync(srcDir)) {
      return NextResponse.json({ error: 'Plugin source files not found' }, { status: 404 });
    }

    const bundleFiles = await fs.readdir(srcDir);
    const dataDirs = getPrusaSlicerDataDirs();
    const installedPaths = [];

    for (let i = 0; i < dataDirs.length; i++) {
      const dataDir = dataDirs[i];
      if (i === 0 || existsSync(dataDir)) {
        const targetBundleDir = path.join(dataDir, 'lua', PLUGIN_ID);
        await fs.mkdir(targetBundleDir, { recursive: true });
        for (const f of bundleFiles) {
          await fs.copyFile(path.join(srcDir, f), path.join(targetBundleDir, f));
        }

        if (existsSync(pubKeyPath)) {
          const authDir = path.join(dataDir, 'authorized_authors');
          await fs.mkdir(authDir, { recursive: true });
          await fs.copyFile(pubKeyPath, path.join(authDir, 'prusalapse.pem'));
        }

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
