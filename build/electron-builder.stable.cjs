const alpha = require('./electron-builder.alpha.cjs');

module.exports = {
  ...alpha,
  directories: {
    ...alpha.directories,
    output: 'release/latest',
  },
  publish: {
    ...alpha.publish,
    channel: 'latest',
  },
};
