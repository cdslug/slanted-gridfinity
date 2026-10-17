/**
 * stl-export.js — Binary STL file generation and download.
 */

// `positions` holds 9 floats (three xyz vertices) per triangle, CCW from
// outside; face normals are computed here since the viewer doesn't store them.
export function generateBinarySTL(positions, triangleCount = positions.length / 9) {
  const bufferSize = 84 + triangleCount * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // 80-byte header
  const header = 'Slanted Gridfinity Bin - slanted-gridfinity generator';
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  }

  // Triangle count (uint32 LE)
  view.setUint32(80, triangleCount, true);

  let offset = 84;
  for (let i = 0; i < triangleCount; i++) {
    const pi = i * 9;

    // Face normal (3x float32 LE)
    const ax = positions[pi + 3] - positions[pi], ay = positions[pi + 4] - positions[pi + 1], az = positions[pi + 5] - positions[pi + 2];
    const bx = positions[pi + 6] - positions[pi], by = positions[pi + 7] - positions[pi + 1], bz = positions[pi + 8] - positions[pi + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    view.setFloat32(offset, nx / len, true); offset += 4;
    view.setFloat32(offset, ny / len, true); offset += 4;
    view.setFloat32(offset, nz / len, true); offset += 4;

    // 3 vertices (9x float32 LE)
    for (let v = 0; v < 9; v++) {
      view.setFloat32(offset, positions[pi + v], true); offset += 4;
    }

    // Attribute byte count (uint16 LE)
    view.setUint16(offset, 0, true); offset += 2;
  }

  return buffer;
}

export function downloadSTL(arrayBuffer, filename = 'slanted-gridfinity.stl') {
  const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
