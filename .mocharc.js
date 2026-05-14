'use strict';

module.exports = {
  recursive: true,
  timeout: 10000,
  reporter: 'spec',
  spec: 'test/**/test-*.js',
  ignore: 'test/**/test-specs-browser.js'
};
