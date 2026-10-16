'use client';

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Center } from '@react-three/drei';
import * as THREE from 'three';

const BED_SIZE_X = 250;
const BED_SIZE_Y = 210;

function GcodeGeometry({ parsedGcode, currentMoveIndex, setExtruderPos }) {
  const lineRef = useRef();

  const { positions, colors, movesData } = useMemo(() => {
    if (!parsedGcode || !parsedGcode.layers) return { positions: new Float32Array(0), colors: new Float32Array(0), movesData: [] };

    const posArray = [];
    const colArray = [];
    const mData = [];
    
    // Default colors
    const colorExtrude = new THREE.Color('#ff8c00'); // Orange for extrusion
    const colorTravel = new THREE.Color('#4169e1'); // Blue for travel
    const colorRetract = new THREE.Color('#ff0000'); // Red for retract
    const colorFeature = {
      'EXTERNAL_PERIMETER': new THREE.Color('#ffa500'),
      'INNER_PERIMETER': new THREE.Color('#ffff00'),
      'SOLID_INFILL': new THREE.Color('#ff00ff'),
      'TOP_SOLID_INFILL': new THREE.Color('#ff0000'),
      'INFILL': new THREE.Color('#8b0000'),
      'SUPPORT': new THREE.Color('#00ff00'),
      'SKIRT': new THREE.Color('#808080'),
    };

    let prevX = 0;
    let prevY = 0;
    let prevZ = 0;
    let hasPrev = false;

    // We use LineSegments, so each move needs a start and end point
    for (const layer of parsedGcode.layers) {
      for (const move of layer.moves) {
        if (hasPrev) {
          // Point A
          posArray.push(prevX, prevZ, -prevY); // Map Y to -Z in ThreeJS space for correct orientation
          // Point B
          posArray.push(move.x, move.z, -move.y);

          mData.push({ x: move.x, y: move.y, z: move.z, type: move.featureType, e: move.e });

          let col = colorExtrude;
          if (move.isTravel) {
            col = colorTravel;
          } else if (move.isRetracted) {
            col = colorRetract;
          } else if (move.featureType && colorFeature[move.featureType]) {
            col = colorFeature[move.featureType];
          }

          // Both vertices get the same color for sharp segments
          colArray.push(col.r, col.g, col.b);
          colArray.push(col.r, col.g, col.b);
        }

        prevX = move.x;
        prevY = move.y;
        prevZ = move.z;
        hasPrev = true;
      }
    }

    return {
      positions: new Float32Array(posArray),
      colors: new Float32Array(colArray),
      movesData: mData
    };
  }, [parsedGcode]);

  useFrame(() => {
    if (lineRef.current && lineRef.current.geometry) {
      // drawRange takes (start, count) in vertices. 
      // 1 move = 2 vertices.
      lineRef.current.geometry.setDrawRange(0, currentMoveIndex * 2);
    }
  });

  useEffect(() => {
    if (movesData.length > 0 && currentMoveIndex > 0) {
      const idx = Math.min(currentMoveIndex - 1, movesData.length - 1);
      const move = movesData[idx];
      setExtruderPos([move.x, move.z, -move.y]);
    } else if (movesData.length > 0 && currentMoveIndex === 0) {
      setExtruderPos([movesData[0].x, movesData[0].z, -movesData[0].y]);
    }
  }, [currentMoveIndex, movesData, setExtruderPos]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    if (positions.length > 0) {
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    return geo;
  }, [positions, colors]);

  if (positions.length === 0) return null;

  return (
    <lineSegments ref={lineRef} geometry={geometry}>
      <lineBasicMaterial vertexColors={true} linewidth={1} />
    </lineSegments>
  );
}

function ExtruderNozzle({ position }) {
  return (
    <group position={position}>
      {/* Small cone pointing down to the position */}
      <mesh position={[0, 5, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[3, 10, 16]} />
        <meshStandardMaterial color="#ff4444" metalness={0.5} roughness={0.2} />
      </mesh>
    </group>
  );
}

export default function GcodePreview3D({ parsedGcode }) {
  const [currentMoveIndex, setCurrentMoveIndex] = useState(0);
  const [totalMoves, setTotalMoves] = useState(0);
  const [extruderPos, setExtruderPos] = useState([0, 0, 0]);

  useEffect(() => {
    if (parsedGcode && parsedGcode.layers) {
      let count = 0;
      for (const layer of parsedGcode.layers) {
        count += layer.moves.length;
      }
      // Since first move doesn't draw a line (it's the start point),
      // total segments = count - 1.
      setTotalMoves(Math.max(0, count - 1));
      setCurrentMoveIndex(Math.max(0, count - 1)); // Default to end of print
    }
  }, [parsedGcode]);

  const handleSliderChange = (e) => {
    setCurrentMoveIndex(parseInt(e.target.value, 10));
  };

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{
        height: '500px', 
        width: '100%', 
        border: '1px solid var(--border-color)', 
        borderRadius: '8px', 
        overflow: 'hidden',
        background: '#1a1a1a',
        position: 'relative'
      }}>
        <Canvas camera={{ position: [0, 150, 200], fov: 45 }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[100, 200, 100]} intensity={1} />
          
          <Center top>
            <group>
              <Grid 
                infiniteGrid={true} 
                cellSize={10} 
                sectionSize={50} 
                fadeDistance={500} 
                fadeStrength={1} 
                cellColor="#333" 
                sectionColor="#666" 
                position={[BED_SIZE_X/2, 0, -BED_SIZE_Y/2]}
              />
              {/* Build plate outline */}
              <mesh position={[BED_SIZE_X/2, -0.1, -BED_SIZE_Y/2]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[BED_SIZE_X, BED_SIZE_Y]} />
                <meshBasicMaterial color="#222" side={THREE.DoubleSide} />
              </mesh>

              <GcodeGeometry 
                parsedGcode={parsedGcode} 
                currentMoveIndex={currentMoveIndex} 
                setExtruderPos={setExtruderPos} 
              />
              
              <ExtruderNozzle position={extruderPos} />
            </group>
          </Center>

          <OrbitControls 
            makeDefault 
            maxPolarAngle={Math.PI / 2 + 0.1} 
            minDistance={10} 
            maxDistance={500} 
          />
        </Canvas>
        
        {/* Floating overlay with stats */}
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          background: 'rgba(0,0,0,0.7)',
          padding: '10px',
          borderRadius: '4px',
          color: 'white',
          fontSize: '12px',
          pointerEvents: 'none',
          fontFamily: 'monospace'
        }}>
          <div>Move: {currentMoveIndex.toLocaleString()} / {totalMoves.toLocaleString()}</div>
          <div>Extruder: X:{extruderPos[0]?.toFixed(1)} Y:{-extruderPos[2]?.toFixed(1)} Z:{extruderPos[1]?.toFixed(1)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px' }}>
        <button 
          className="btn btn-ghost btn-small"
          onClick={() => setCurrentMoveIndex(0)}
          style={{ padding: '4px 10px' }}
        >
          |&lt;
        </button>
        <input 
          type="range" 
          min="0" 
          max={totalMoves} 
          value={currentMoveIndex} 
          onChange={handleSliderChange}
          style={{ flex: 1, cursor: 'pointer' }}
        />
        <button 
          className="btn btn-ghost btn-small"
          onClick={() => setCurrentMoveIndex(totalMoves)}
          style={{ padding: '4px 10px' }}
        >
          &gt;|
        </button>
      </div>
    </div>
  );
}
