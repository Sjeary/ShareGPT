const electron = require('electron');
console.log('type', typeof electron);
console.log('keys', Object.keys(electron).slice(0, 20));
console.log('has', Boolean(electron.app), Boolean(electron.BrowserWindow), Boolean(electron.WebContentsView));
