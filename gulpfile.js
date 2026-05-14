/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 Apigee Corporation
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

'use strict';

// ---------------------------------------------------------------------------
// Gulp 4 gulpfile — replaces the old Gulp 3 / run-sequence setup.
//
// Key changes:
//   • gulp.series / gulp.parallel replace runSequence and task-dependency arrays.
//   • NSP task removed (npm audit replaces it).
//   • gulp-istanbul replaced by nyc (invoked via npm script; see package.json).
//   • Browser tests kept behind a separate `gulp test-browser` target so that
//     `npm test` (= `gulp test-node`) does not require PhantomJS.
// ---------------------------------------------------------------------------

var browserify = require('browserify');
var buffer     = require('vinyl-buffer');
var del        = require('del');
var exposify   = require('exposify');
var fs         = require('fs');
var gulp       = require('gulp');
var path       = require('path');
var source     = require('vinyl-source-stream');

var cp         = require('child_process');

// Lazily-loaded plugins (jshint, uglify).
var $          = require('gulp-load-plugins')();

// ---------------------------------------------------------------------------
// Browserify builds
// ---------------------------------------------------------------------------
function browserifyBuild (isStandalone, useDebug) {
  return function () {
    return new Promise(function (resolve, reject) {
      var b = browserify('./lib/specs.js', {
        debug: useDebug,
        standalone: 'SwaggerTools.specs'
      });

      if (!isStandalone) {
        exposify.config = {
          'async': 'async',
          'debug': 'debug',
          'json-refs': 'JsonRefs',
          'js-yaml': 'jsyaml',
          'lodash': '_',
          'spark-md5': 'SparkMD5',
          'swagger-converter': 'SwaggerConverter.convert',
          'traverse': 'traverse',
          'z-schema': 'ZSchema'
        };
        b.transform('exposify');
      }

      b.bundle()
        .pipe(source('swagger-tools' + (isStandalone ? '-standalone' : '') + (!useDebug ? '-min' : '') + '.js'))
        .pipe($.if(!useDebug, buffer()))
        .pipe($.if(!useDebug, $.uglify()))
        .pipe(gulp.dest('browser/'))
        .on('error', reject)
        .on('end', resolve);
    });
  };
}

gulp.task('browserify', function () {
  return Promise.resolve()
    .then(browserifyBuild(true,  true))
    .then(browserifyBuild(true,  false))
    .then(browserifyBuild(false, true))
    .then(browserifyBuild(false, false));
});

// ---------------------------------------------------------------------------
// Lint
// ---------------------------------------------------------------------------
gulp.task('lint', function () {
  return gulp.src([
    './bin/swagger-tools',
    './index.js',
    './lib/**/*.js',
    './middleware/helpers.js',
    './middleware/swagger-*.js',
    './test/**/*.js',
    './gulpfile.js',
    '!./middleware/swagger-ui/**/*.js',
    '!./test/**/test-specs-browser.js',
    '!./test/browser/vendor/*.js'
  ])
    .pipe($.jshint())
    .pipe($.jshint.reporter('jshint-stylish'))
    .pipe($.jshint.reporter('fail'));
});

// ---------------------------------------------------------------------------
// Node tests — spawn mocha directly so no gulp-mocha (or browserslist) dep needed.
// ---------------------------------------------------------------------------
gulp.task('test-node', function (done) {
  var result = cp.spawnSync(
    process.execPath,
    [require.resolve('mocha/bin/mocha')],
    { stdio: 'inherit' }
  );
  done(result.status !== 0 ? new Error('Tests failed with exit code ' + result.status) : null);
});

// ---------------------------------------------------------------------------
// Browser tests (karma + browserify)
// ---------------------------------------------------------------------------
var KarmaServer = require('karma').Server;

gulp.task('test-browser', gulp.series('browserify', function runBrowserTests () {
  function cleanUpEach () {
    return del(['./test/browser/test-browser.js']);
  }

  function cleanUpAll () {
    return Promise.all([
      del(['./test/browser/test-browser.js']),
      del(['./test/browser/swagger-tools.js']),
      del(['./test/browser/swagger-tools-standalone.js'])
    ]);
  }

  function makeTest (version, standalone) {
    return function () {
      return cleanUpEach()
        .then(function () {
          return new Promise(function (resolve, reject) {
            browserify(['./test/' + version + '/test-specs.js'], { debug: true })
              .bundle()
              .pipe(source('test-browser.js'))
              .pipe(gulp.dest('./test/browser'))
              .on('error', reject)
              .on('end', resolve);
          });
        })
        .then(function () {
          return new Promise(function (resolve, reject) {
            new KarmaServer({
              configFile: path.join(__dirname,
                'test/browser/karma-' + (standalone ? 'standalone' : 'bower') + '.conf.js'),
              singleRun: true
            }, function (exitCode) {
              exitCode ? reject(new Error('Karma exited with ' + exitCode)) : resolve();
            }).start();
          });
        });
    };
  }

  return cleanUpAll()
    .then(function () {
      fs.createReadStream('./browser/swagger-tools.js')
        .pipe(fs.createWriteStream('test/browser/swagger-tools.js'));
      fs.createReadStream('./browser/swagger-tools-standalone.js')
        .pipe(fs.createWriteStream('./test/browser/swagger-tools-standalone.js'));
    })
    .then(makeTest('1.2', false))
    .then(makeTest('1.2', true))
    .then(makeTest('2.0', false))
    .then(makeTest('2.0', true))
    .then(cleanUpAll, function (err) { return cleanUpAll().then(function () { throw err; }); });
}));

// ---------------------------------------------------------------------------
// Default: lint + node tests only (browser tests run separately)
// ---------------------------------------------------------------------------
gulp.task('test', gulp.series('test-node'));
gulp.task('default', gulp.series('lint', 'test-node'));

