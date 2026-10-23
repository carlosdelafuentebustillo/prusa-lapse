function mapFeatureType(typeComment) {
  const upper = typeComment.toUpperCase();
  if (upper.includes('EXTERNAL PERIMETER')) return 'EXTERNAL_PERIMETER';
  if (upper.includes('PERIMETER')) return 'INNER_PERIMETER';
  if (upper.includes('TOP SOLID INFILL')) return 'TOP_SOLID_INFILL';
  if (upper.includes('SOLID INFILL') || upper.includes('BRIDGE INFILL')) return 'SOLID_INFILL';
  if (upper.includes('INFILL')) return 'INFILL';
  if (upper.includes('SUPPORT')) return 'SUPPORT';
  if (upper.includes('SKIRT') || upper.includes('BRIM')) return 'SKIRT';
  return null;
}

export function parseGcodeForPreview(gcodeText) {
  if (!gcodeText || typeof gcodeText !== 'string') {
    return { layers: [] };
  }

  const lines = gcodeText.split(/\r?\n/);
  const layers = [];
  let currentLayer = { z: 0, moves: [] };
  layers.push(currentLayer);

  let curX = 0;
  let curY = 0;
  let curZ = 0;
  let curE = 0;
  let isRelativeXYZ = false;
  let isRelativeE = true; // PrusaSlicer defaults to M83 relative E
  let isRetracted = false;
  let currentFeature = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    if (rawLine.startsWith(';')) {
      if (rawLine.startsWith(';TYPE:')) {
        currentFeature = mapFeatureType(rawLine.substring(6).trim());
      } else if (rawLine.startsWith(';LAYER_CHANGE') || rawLine.startsWith(';AFTER_LAYER_CHANGE')) {
        if (currentLayer.moves.length > 0) {
          currentLayer = { z: curZ, moves: [] };
          layers.push(currentLayer);
        }
      }
      continue;
    }

    // Strip inline comments
    const codePart = rawLine.split(';')[0].trim();
    if (!codePart) continue;

    const tokens = codePart.split(/\s+/);
    const cmd = tokens[0].toUpperCase();

    if (cmd === 'G90') {
      isRelativeXYZ = false;
      isRelativeE = false;
      continue;
    }
    if (cmd === 'G91') {
      isRelativeXYZ = true;
      isRelativeE = true;
      continue;
    }
    if (cmd === 'M82') {
      isRelativeE = false;
      continue;
    }
    if (cmd === 'M83') {
      isRelativeE = true;
      continue;
    }
    if (cmd === 'G92') {
      for (let t = 1; t < tokens.length; t++) {
        const axis = tokens[t][0]?.toUpperCase();
        const val = parseFloat(tokens[t].substring(1));
        if (!Number.isNaN(val)) {
          if (axis === 'X') curX = val;
          else if (axis === 'Y') curY = val;
          else if (axis === 'Z') curZ = val;
          else if (axis === 'E') curE = val;
        }
      }
      continue;
    }

    if (cmd === 'G0' || cmd === 'G1') {
      let nextX = curX;
      let nextY = curY;
      let nextZ = curZ;
      let deltaE = 0;
      let hasXY = false;
      let hasZ = false;
      let hasE = false;

      for (let t = 1; t < tokens.length; t++) {
        const token = tokens[t];
        const axis = token[0]?.toUpperCase();
        const val = parseFloat(token.substring(1));
        if (Number.isNaN(val)) continue;

        if (axis === 'X') {
          nextX = isRelativeXYZ ? curX + val : val;
          hasXY = true;
        } else if (axis === 'Y') {
          nextY = isRelativeXYZ ? curY + val : val;
          hasXY = true;
        } else if (axis === 'Z') {
          nextZ = isRelativeXYZ ? curZ + val : val;
          hasZ = true;
        } else if (axis === 'E') {
          deltaE = isRelativeE ? val : val - curE;
          curE = isRelativeE ? curE + val : val;
          hasE = true;
        }
      }

      if (hasE && !hasXY && deltaE < 0) {
        isRetracted = true;
      } else if (hasE && deltaE > 0) {
        isRetracted = false;
      }

      if (hasXY || hasZ) {
        const isExtruding = hasE && deltaE > 0;
        const isTravel = !isExtruding;

        if (hasZ && nextZ !== curZ && !isRelativeXYZ && currentLayer.moves.length > 20) {
          currentLayer = { z: nextZ, moves: [] };
          layers.push(currentLayer);
        }

        curX = nextX;
        curY = nextY;
        curZ = nextZ;

        currentLayer.moves.push({
          x: curX,
          y: curY,
          z: curZ,
          e: deltaE,
          isTravel,
          isRetracted: isTravel && isRetracted,
          featureType: isExtruding ? currentFeature : null
        });
      }
    }
  }

  return {
    layers: layers.filter(l => l.moves.length > 0)
  };
}

export function injectTriggers(gcodeText, config = {}) {
  const {
    triggerType = 'park',
    parkX = 240,
    parkY = 210,
    travelSpeed = 6000,
    retractDistance = 2.0,
    retractSpeed = 2100,
    zHopHeight = 0.4,
    settleTime = 500,
    captureTime = 2000,
    triggerSignal = 'm220'
  } = config;

  const lines = gcodeText.split(/\r?\n/);
  const outLines = [];
  let layersModified = 0;
  let layerIndex = 0;

  let lastX = null;
  let lastY = null;
  let smoothX = null;
  let smoothY = null;
  let isRelativeXYZ = false;
  let isRelativeE = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed.startsWith(';')) {
      const codePart = trimmed.split(';')[0].trim();
      if (codePart) {
        const tokens = codePart.split(/\s+/);
        const cmd = tokens[0].toUpperCase();
        if (cmd === 'G90') {
          isRelativeXYZ = false;
        } else if (cmd === 'G91') {
          isRelativeXYZ = true;
        } else if (cmd === 'M82') {
          isRelativeE = false;
        } else if (cmd === 'M83') {
          isRelativeE = true;
        } else if ((cmd === 'G0' || cmd === 'G1') && !isRelativeXYZ) {
          for (let t = 1; t < tokens.length; t++) {
            const axis = tokens[t][0]?.toUpperCase();
            const val = parseFloat(tokens[t].substring(1));
            if (!Number.isNaN(val)) {
              if (axis === 'X') lastX = val;
              else if (axis === 'Y') lastY = val;
            }
          }
        }
      }
    }

    outLines.push(line);

    if (trimmed.startsWith(';AFTER_LAYER_CHANGE')) {
      layerIndex++;
      // Skip layer 0 (initial start G-code / purge line)
      if (layerIndex <= 1 && (lastX === null || lastY === null)) {
        continue;
      }

      layersModified++;
      outLines.push('; --- PRUSA-LAPSE START ---');

      // 1. Retract filament
      if (retractDistance > 0) {
        outLines.push(`G1 E-${retractDistance} F${retractSpeed} ; Retract`);
      }

      // 2. Z-Hop lift
      if (zHopHeight > 0) {
        outLines.push('G91 ; Relative positioning for Z-hop');
        outLines.push(`G1 Z${zHopHeight} F600 ; Z-hop lift`);
        outLines.push('G90 ; Return to absolute positioning');
        if (isRelativeE) outLines.push('M83 ; Restore relative extrusion');
      }

      // 3. Move to Park or Snap position
      let didMoveXY = false;
      if (triggerType === 'park') {
        outLines.push(`G1 X${parkX} Y${parkY} F${travelSpeed} ; Move to park position`);
        didMoveXY = true;
      } else if (triggerType === 'snap' && lastX !== null && lastY !== null) {
        // Snap towards anchor slightly or hold clean anchor position
        outLines.push(`G1 X${lastX.toFixed(3)} Y${lastY.toFixed(3)} F${travelSpeed} ; Snap anchor`);
      } else if (triggerType === 'snap-smooth' && lastX !== null && lastY !== null) {
        if (smoothX === null || smoothY === null) {
          smoothX = lastX;
          smoothY = lastY;
        } else {
          smoothX = smoothX * 0.8 + lastX * 0.2;
          smoothY = smoothY * 0.8 + lastY * 0.2;
        }
        outLines.push(`G1 X${smoothX.toFixed(3)} Y${smoothY.toFixed(3)} F${travelSpeed} ; Smooth snap position`);
        didMoveXY = true;
      }

      // 4. Wait for vibrations to settle
      if (settleTime > 0) {
        outLines.push(`G4 P${settleTime} ; Wait for vibrations to settle`);
      }

      // 5. Trigger signal
      if (triggerSignal === 'gpio0') {
        outLines.push('M264 P0 S1 ; Trigger Hackerboard GPIO');
        outLines.push('G4 P100');
        outLines.push('M264 P0 S0 ; Reset Hackerboard GPIO');
      } else if (triggerSignal === 'serial') {
        outLines.push('M118 action:capture_photo ; Trigger Serial');
      } else if (triggerSignal === 'm221') {
        outLines.push('M221 S99 ; Trigger PrusaLink capture via Flow factor');
      } else {
        outLines.push('M220 S99 ; Trigger PrusaLink capture');
      }

      // 6. Wait for camera capture
      if (captureTime > 0) {
        outLines.push(`G4 P${captureTime} ; Wait for camera capture`);
      }

      // 7. Restore speed/flow factor if M220/M221 was used
      if (triggerSignal === 'm221') {
        outLines.push('M221 S100 ; Restore flow factor');
      } else if (triggerSignal !== 'gpio0' && triggerSignal !== 'serial') {
        outLines.push('M220 S100 ; Restore speed factor');
      }

      // 8. Return to previous X/Y before lowering Z and un-retracting
      if (didMoveXY && lastX !== null && lastY !== null) {
        outLines.push(`G1 X${lastX.toFixed(3)} Y${lastY.toFixed(3)} F${travelSpeed} ; Return to print position`);
      }

      // 9. Undo Z-Hop
      if (zHopHeight > 0) {
        outLines.push('G91 ; Relative positioning for Z-hop restore');
        outLines.push(`G1 Z-${zHopHeight} F600 ; Undo Z-hop`);
        outLines.push('G90 ; Return to absolute positioning');
        if (isRelativeE) outLines.push('M83 ; Restore relative extrusion');
      }

      // 10. Un-retract filament
      if (retractDistance > 0) {
        outLines.push(`G1 E${retractDistance} F${retractSpeed} ; Un-retract`);
      }

      outLines.push('; --- PRUSA-LAPSE END ---');
    }
  }

  return { newGcode: outLines.join('\n'), layersModified };
}

export function parseGcode(gcodeText, config) {
  if (config && typeof config === 'object') {
    return injectTriggers(gcodeText, config);
  }
  return parseGcodeForPreview(gcodeText);
}