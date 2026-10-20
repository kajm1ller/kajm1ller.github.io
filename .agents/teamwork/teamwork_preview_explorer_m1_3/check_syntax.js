const fs = require('fs');
const path = require('path');
const vm = require('vm');

const gameHtml = fs.readFileSync(path.join(__dirname, '../../../game.html'), 'utf8');
const scriptMatch = gameHtml.match(/<script type="module">([\s\S]*?)<\/script>/);

if (!scriptMatch) {
    console.error('No module script found in game.html');
    process.exit(1);
}

const code = scriptMatch[1];
console.log('Script length:', code.length);

try {
    if (vm.SourceTextModule) {
        new vm.SourceTextModule(code);
        console.log('Module syntax parse succeeded!');
    } else {
        console.log('SourceTextModule not enabled, use --experimental-vm-modules');
    }
} catch (e) {
    console.error('Syntax error detected:', e);
}
