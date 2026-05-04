const fs = require('fs');
const path = 'server/lib/postgresStore.js';
let lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);
lines = lines.filter(line => !line.includes("dev_eui = 'node-tech-01'") || !line.includes("UPDATE sensors"));
// Wait, my filter is too broad. Let's be precise.
let filteredLines = lines.filter(line => {
    return !(line.includes("UPDATE sensors") && line.includes("node-tech-01"));
});
fs.writeFileSync(path, filteredLines.join('\n'));
console.log('done');
