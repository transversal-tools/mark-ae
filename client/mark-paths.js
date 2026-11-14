// Mark — where things live on macOS and Windows.
//   data:      ~/Library/Application Support/Mark   |  %APPDATA%\Mark
//   binDirs:   where claude / node are usually installed (AE does not get the
//              login shell's PATH, so these are searched first)

const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const HOME = os.homedir();

const DATA = IS_WIN
    ? path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'Mark')
    : path.join(HOME, 'Library', 'Application Support', 'Mark');

const BIN_DIRS = IS_WIN
    ? [
        path.join(HOME, '.local', 'bin'),                                     // Claude Code native installer
        path.join(process.env.APPDATA || '', 'npm'),                          // npm -g
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs')
    ].filter((d) => d && d !== 'npm')
    : [path.join(HOME, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];

// A short, stable name for this computer, used to keep each machine's backup apart.
function machineName() {
    const raw = (IS_WIN ? 'Windows ' : 'Mac ') + (os.hostname() || '').replace(/\.local$/i, '');
    return raw.replace(/[^\w .-]+/g, '').trim() || (IS_WIN ? 'Windows' : 'Mac');
}

module.exports = { IS_WIN, HOME, DATA, BIN_DIRS, machineName };
