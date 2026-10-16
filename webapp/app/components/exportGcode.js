import { injectTriggers } from './gcodeParser';

export async function processGcode(file, config, triggerType) {
  const text = typeof file === 'string' ? file : await file.text();
  const mergedConfig = {
    ...config,
    triggerType: triggerType || config?.triggerType || 'park'
  };
  const { newGcode, layersModified } = injectTriggers(text, mergedConfig);

  const blob = new Blob([newGcode], { type: 'text/plain;charset=utf-8' });
  const outName = typeof file === 'string' ? 'output_prusalapse.gcode' : file.name.replace(/\.gcode$/i, '_prusalapse.gcode');

  return { blob, outName, outputText: newGcode, layersModified };
}