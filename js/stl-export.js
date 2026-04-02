/**
 * stl-export.js — Binary STL file generation and download.
 */

export function generateBinarySTL(positions, normals, triangleCount) {
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
    const ni = i * 9;
    const pi = i * 9;

    // Face normal (3x float32 LE)
    view.setFloat32(offset, normals[ni],     true); offset += 4;
    view.setFloat32(offset, normals[ni + 1], true); offset += 4;
    view.setFloat32(offset, normals[ni + 2], true); offset += 4;

    // 3 vertices (9x float32 LE)
    for (let v = 0; v < 3; v++) {
      const vi = pi + v * 3;
      view.setFloat32(offset, positions[vi],     true); offset += 4;
      view.setFloat32(offset, positions[vi + 1], true); offset += 4;
      view.setFloat32(offset, positions[vi + 2], true); offset += 4;
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
