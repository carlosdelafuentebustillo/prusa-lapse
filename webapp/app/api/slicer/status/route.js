import { getOrcaSlicerPaths } from '../utils.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { installed, orcaDirectoryFound, targetDir, pluginDir } = getOrcaSlicerPaths();
    return Response.json({
      installed,
      orcaDirectoryFound,
      targetDir,
      pluginDir
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
