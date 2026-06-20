require('dotenv').config();
const { runSync } = require('./pipeline');

runSync()
  .then(stats => {
    console.log('Summary:', stats);
    process.exit(0);
  })
  .catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });
