// Load the native module based on platform
const { existsSync } = require('fs');
const { join } = require('path');

const { platform, arch } = process;

let nativeBinding = null;
let loadError = null;

// Determine the platform-specific binary name
const platformArch = `${platform}-${arch}`;
const binaryName = `typedb-node.${platformArch === 'darwin-arm64' ? 'darwin-arm64' :
                                    platformArch === 'darwin-x64' ? 'darwin-x64' :
                                    platformArch === 'linux-x64' ? 'linux-x64-gnu' :
                                    platformArch === 'linux-arm64' ? 'linux-arm64-gnu' :
                                    platformArch === 'win32-x64' ? 'win32-x64-msvc' :
                                    platformArch}.node`;

const localPath = join(__dirname, binaryName);

if (existsSync(localPath)) {
  try {
    nativeBinding = require(localPath);
  } catch (e) {
    loadError = e;
  }
}

if (!nativeBinding) {
  if (loadError) {
    throw loadError;
  }
  throw new Error(`Failed to load native binding for ${platform}-${arch}. Expected: ${localPath}`);
}

module.exports = nativeBinding;
