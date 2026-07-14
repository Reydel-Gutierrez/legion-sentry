const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Atomically write text to a path using temp file + rename.
 * Creates a .bak sibling before overwriting an existing file.
 */
function atomicWriteFile(filePath, contents, { backup = true } = {}) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (backup && fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, `${filePath}.bak`);
    } catch {
      // Best-effort backup; continue with write
    }
  }

  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );

  fs.writeFileSync(tempPath, contents, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function atomicWriteJson(filePath, value, { backup = true, space = 2 } = {}) {
  const payload = `${JSON.stringify(value, null, space)}\n`;
  atomicWriteFile(filePath, payload, { backup });
}

module.exports = {
  atomicWriteFile,
  atomicWriteJson,
};
