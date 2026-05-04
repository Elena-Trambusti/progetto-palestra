const fs = require('fs');
let c = fs.readFileSync('server/lib/postgresStore.js', 'utf8');

c = c.replace(
  "('controsoffitti', 'Controsoffitti Palestra', '1', 50, 20, 'technical', 'node-tech-01')",
  "('controsoffitti', 'Controsoffitti Palestra', '1', 50, 20, 'technical', NULL)"
);

c = c.replace(
  "      UPDATE sensors SET location = 'Controsoffitti Palestra', name = 'Nodo Controsoffitti', zone_id = 'controsoffitti' WHERE dev_eui = 'node-tech-01';\\n",
  ""
);

c = c.replace(
  "'node-water-01', 'node-env-01', 'node-tech-01', 'gw-livorno-01'",
  "'node-water-01', 'node-env-01', 'gw-livorno-01'"
);

fs.writeFileSync('server/lib/postgresStore.js', c);
console.log('done');
